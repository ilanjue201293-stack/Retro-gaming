import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { requireRoomMember } from "@/lib/room";
import { cleanRoomCode } from "@/lib/utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Side = "blue" | "red";
type MatchPlayer = { userId: string; username: string; side: Side };
type Disc = { id: string; side: Side; x: number; y: number };
type Ball = { x: number; y: number };
type Possession = { discId: string; side: Side } | null;
type LastAction = {
  type: "start" | "move" | "kick" | "goal" | "stop";
  by: string | null;
  discId: string | null;
  caughtBy: string | null;
  goalSide: Side | null;
  at: number;
};
type Row = {
  room_code: string;
  status: "lobby" | "playing" | "gameover";
  mode: number;
  players: unknown;
  discs: unknown;
  ball: unknown;
  turn_side: Side;
  moves_left: number;
  possession: unknown;
  blue_score: number;
  red_score: number;
  target_score: number;
  winner_side: Side | null;
  action_seq: string | number;
  last_action: unknown;
};

type SimDisc = Disc & { vx: number; vy: number };
type SimBall = Ball & { vx: number; vy: number };

const DISC_RADIUS = 0.041;
const BALL_RADIUS = 0.027;
const GOAL_LEFT = 0.34;
const GOAL_RIGHT = 0.66;
const STEP = 1 / 100;
const MAX_STEPS = 230;

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const opposite = (side: Side): Side => side === "blue" ? "red" : "blue";
const freshBall = (): Ball => ({ x: 0.5, y: 0.5 });

function initialDiscs(): Disc[] {
  const blue = [
    [0.5, 0.90],
    [0.27, 0.75],
    [0.73, 0.75],
    [0.37, 0.62],
    [0.63, 0.62],
  ];
  const red = blue.map(([x, y]) => [x, 1 - y]);
  return [
    ...blue.map(([x, y], index) => ({ id: `blue-${index + 1}`, side: "blue" as const, x, y })),
    ...red.map(([x, y], index) => ({ id: `red-${index + 1}`, side: "red" as const, x, y })),
  ];
}

function direction(side: Side, aim: number) {
  const x = clamp(aim, -1, 1) * 0.86;
  const y = side === "blue" ? -1 : 1;
  const length = Math.hypot(x, y) || 1;
  return { x: x / length, y: y / length };
}

function parsePlayers(value: unknown): MatchPlayer[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const raw = entry as Partial<MatchPlayer>;
    if (!raw.userId || !raw.username || (raw.side !== "blue" && raw.side !== "red")) return [];
    return [{ userId: String(raw.userId), username: String(raw.username), side: raw.side }];
  });
}

function parseDiscs(value: unknown): Disc[] {
  if (!Array.isArray(value)) return initialDiscs();
  const discs = value.flatMap((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const raw = entry as Partial<Disc>;
    if (!raw.id || (raw.side !== "blue" && raw.side !== "red")) return [];
    return [{ id: String(raw.id), side: raw.side, x: clamp(Number(raw.x) || 0.5, DISC_RADIUS, 1 - DISC_RADIUS), y: clamp(Number(raw.y) || 0.5, DISC_RADIUS, 1 - DISC_RADIUS) }];
  });
  return discs.length === 10 ? discs : initialDiscs();
}

function parseBall(value: unknown): Ball {
  if (!value || typeof value !== "object" || Array.isArray(value)) return freshBall();
  const raw = value as Partial<Ball>;
  return { x: clamp(Number(raw.x) || 0.5, -0.08, 1.08), y: clamp(Number(raw.y) || 0.5, -0.08, 1.08) };
}

function parsePossession(value: unknown): Possession {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Partial<NonNullable<Possession>>;
  if (!raw.discId || (raw.side !== "blue" && raw.side !== "red")) return null;
  return { discId: String(raw.discId), side: raw.side };
}

function parseLastAction(value: unknown): LastAction | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Partial<LastAction>;
  if (!raw.type || !["start", "move", "kick", "goal", "stop"].includes(raw.type)) return null;
  return {
    type: raw.type,
    by: raw.by ? String(raw.by) : null,
    discId: raw.discId ? String(raw.discId) : null,
    caughtBy: raw.caughtBy ? String(raw.caughtBy) : null,
    goalSide: raw.goalSide === "blue" || raw.goalSide === "red" ? raw.goalSide : null,
    at: Number(raw.at) || Date.now(),
  };
}

let schemaPromise: Promise<void> | null = null;
async function ensureSchema() {
  if (!schemaPromise) {
    schemaPromise = db().query(`
      create table if not exists retro_football_games (
        room_code text primary key references retro_rooms(code) on delete cascade,
        status text not null default 'lobby',
        mode integer not null default 1,
        players jsonb not null default '[]'::jsonb,
        discs jsonb not null default '[]'::jsonb,
        ball jsonb not null default '{"x":0.5,"y":0.5}'::jsonb,
        turn_side text not null default 'blue',
        moves_left integer not null default 2,
        possession jsonb,
        blue_score integer not null default 0,
        red_score integer not null default 0,
        target_score integer not null default 3,
        winner_side text,
        action_seq bigint not null default 0,
        last_action jsonb,
        updated_at timestamptz not null default now()
      );
      alter table retro_football_games add column if not exists mode integer not null default 1;
      alter table retro_football_games add column if not exists players jsonb not null default '[]'::jsonb;
      alter table retro_football_games add column if not exists discs jsonb not null default '[]'::jsonb;
      alter table retro_football_games add column if not exists ball jsonb not null default '{"x":0.5,"y":0.5}'::jsonb;
      alter table retro_football_games add column if not exists turn_side text not null default 'blue';
      alter table retro_football_games add column if not exists moves_left integer not null default 2;
      alter table retro_football_games add column if not exists possession jsonb;
      alter table retro_football_games add column if not exists blue_score integer not null default 0;
      alter table retro_football_games add column if not exists red_score integer not null default 0;
      alter table retro_football_games add column if not exists target_score integer not null default 3;
      alter table retro_football_games add column if not exists winner_side text;
      alter table retro_football_games add column if not exists action_seq bigint not null default 0;
      alter table retro_football_games add column if not exists last_action jsonb;
    `).then(() => undefined).catch((error) => {
      schemaPromise = null;
      throw error;
    });
  }
  await schemaPromise;
}

async function ensureGame(code: string) {
  await ensureSchema();
  await db().query(`insert into retro_football_games (room_code,discs) values ($1,$2::jsonb) on conflict (room_code) do nothing`, [code, JSON.stringify(initialDiscs())]);
}

async function gameRow(code: string) {
  await ensureGame(code);
  const result = await db().query<Row>(
    `select room_code,status,mode,players,discs,ball,turn_side,moves_left,possession,blue_score,red_score,target_score,winner_side,action_seq::text,last_action
     from retro_football_games where room_code=$1 limit 1`,
    [code]
  );
  if (!result.rows[0]) throw new Error("Foot indisponible.");
  return result.rows[0];
}

function output(row: Row) {
  return {
    status: row.status,
    mode: Number(row.mode) === 2 ? 2 : 1,
    players: parsePlayers(row.players),
    discs: parseDiscs(row.discs),
    ball: parseBall(row.ball),
    turnSide: row.turn_side === "red" ? "red" : "blue",
    movesLeft: clamp(Math.trunc(Number(row.moves_left) || 0), 0, 2),
    possession: parsePossession(row.possession),
    blueScore: Math.max(0, Number(row.blue_score) || 0),
    redScore: Math.max(0, Number(row.red_score) || 0),
    targetScore: clamp(Math.trunc(Number(row.target_score) || 3), 1, 9),
    winnerSide: row.winner_side === "blue" || row.winner_side === "red" ? row.winner_side : null,
    actionSeq: Math.max(0, Number(row.action_seq) || 0),
    lastAction: parseLastAction(row.last_action),
  };
}

function wallDisc(disc: SimDisc) {
  if (disc.x < DISC_RADIUS) { disc.x = DISC_RADIUS; disc.vx = Math.abs(disc.vx) * 0.72; }
  if (disc.x > 1 - DISC_RADIUS) { disc.x = 1 - DISC_RADIUS; disc.vx = -Math.abs(disc.vx) * 0.72; }
  if (disc.y < DISC_RADIUS) { disc.y = DISC_RADIUS; disc.vy = Math.abs(disc.vy) * 0.72; }
  if (disc.y > 1 - DISC_RADIUS) { disc.y = 1 - DISC_RADIUS; disc.vy = -Math.abs(disc.vy) * 0.72; }
}

function resolveDiscPair(a: SimDisc, b: SimDisc) {
  let dx = b.x - a.x;
  let dy = b.y - a.y;
  let dist = Math.hypot(dx, dy);
  const minDist = DISC_RADIUS * 2;
  if (dist >= minDist) return;
  if (dist < 0.00001) { dx = 0.00001; dy = 0; dist = 0.00001; }
  const nx = dx / dist;
  const ny = dy / dist;
  const overlap = minDist - dist;
  a.x -= nx * overlap * 0.5;
  a.y -= ny * overlap * 0.5;
  b.x += nx * overlap * 0.5;
  b.y += ny * overlap * 0.5;
  const relative = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
  if (relative >= 0) return;
  const impulse = -(1 + 0.88) * relative / 2;
  a.vx -= impulse * nx;
  a.vy -= impulse * ny;
  b.vx += impulse * nx;
  b.vy += impulse * ny;
}

function resolveBallCollision(disc: SimDisc, ball: SimBall, ignore = false) {
  if (ignore) return;
  let dx = ball.x - disc.x;
  let dy = ball.y - disc.y;
  let dist = Math.hypot(dx, dy);
  const minDist = DISC_RADIUS + BALL_RADIUS;
  if (dist >= minDist) return;
  if (dist < 0.00001) { dx = 0; dy = 0.00001; dist = 0.00001; }
  const nx = dx / dist;
  const ny = dy / dist;
  const overlap = minDist - dist;
  disc.x -= nx * overlap * 0.34;
  disc.y -= ny * overlap * 0.34;
  ball.x += nx * overlap * 0.66;
  ball.y += ny * overlap * 0.66;

  const invDisc = 1;
  const invBall = 1 / 0.56;
  const relative = (ball.vx - disc.vx) * nx + (ball.vy - disc.vy) * ny;
  if (relative >= 0) return;
  const impulse = -(1 + 0.82) * relative / (invDisc + invBall);
  disc.vx -= impulse * invDisc * nx;
  disc.vy -= impulse * invDisc * ny;
  ball.vx += impulse * invBall * nx;
  ball.vy += impulse * invBall * ny;
}

function goalFor(ball: SimBall): Side | null {
  if (ball.x < GOAL_LEFT || ball.x > GOAL_RIGHT) return null;
  if (ball.y <= 0.012) return "blue";
  if (ball.y >= 0.988) return "red";
  return null;
}

function wallBall(ball: SimBall) {
  if (ball.x < BALL_RADIUS) { ball.x = BALL_RADIUS; ball.vx = Math.abs(ball.vx) * 0.78; }
  if (ball.x > 1 - BALL_RADIUS) { ball.x = 1 - BALL_RADIUS; ball.vx = -Math.abs(ball.vx) * 0.78; }
  if (ball.y < BALL_RADIUS && (ball.x < GOAL_LEFT || ball.x > GOAL_RIGHT)) { ball.y = BALL_RADIUS; ball.vy = Math.abs(ball.vy) * 0.78; }
  if (ball.y > 1 - BALL_RADIUS && (ball.x < GOAL_LEFT || ball.x > GOAL_RIGHT)) { ball.y = 1 - BALL_RADIUS; ball.vy = -Math.abs(ball.vy) * 0.78; }
}

function simulate(discsInput: Disc[], ballInput: Ball, discId: string, side: Side, aim: number, power: number, kind: "move" | "kick") {
  const discs: SimDisc[] = discsInput.map((disc) => ({ ...disc, vx: 0, vy: 0 }));
  const ball: SimBall = { ...ballInput, vx: 0, vy: 0 };
  const shotDirection = direction(side, aim);
  const speed = 0.72 + clamp(power, 0.15, 1) * 1.48;
  const launcher = discs.find((disc) => disc.id === discId);
  if (!launcher) throw new Error("Joueur introuvable sur le terrain.");

  if (kind === "move") {
    launcher.vx = shotDirection.x * speed;
    launcher.vy = shotDirection.y * speed;
  } else {
    const gap = DISC_RADIUS + BALL_RADIUS + 0.004;
    ball.x = clamp(launcher.x + shotDirection.x * gap, BALL_RADIUS, 1 - BALL_RADIUS);
    ball.y = clamp(launcher.y + shotDirection.y * gap, 0.02, 0.98);
    ball.vx = shotDirection.x * speed * 1.18;
    ball.vy = shotDirection.y * speed * 1.18;
  }

  for (let step = 0; step < MAX_STEPS; step++) {
    for (const disc of discs) {
      disc.x += disc.vx * STEP;
      disc.y += disc.vy * STEP;
      wallDisc(disc);
    }
    ball.x += ball.vx * STEP;
    ball.y += ball.vy * STEP;

    const directGoal = goalFor(ball);
    if (directGoal) {
      return {
        discs: discs.map(({ vx: _vx, vy: _vy, ...disc }) => disc),
        ball: { x: ball.x, y: ball.y },
        caughtBy: null as string | null,
        goalSide: directGoal,
      };
    }
    wallBall(ball);

    for (let i = 0; i < discs.length; i++) {
      for (let j = i + 1; j < discs.length; j++) resolveDiscPair(discs[i], discs[j]);
    }

    for (const disc of discs) {
      const dx = ball.x - disc.x;
      const dy = ball.y - disc.y;
      const distance = Math.hypot(dx, dy);
      const touching = distance < DISC_RADIUS + BALL_RADIUS;
      const discSpeed = Math.hypot(disc.vx, disc.vy);
      if (kind === "move" && touching && disc.side === side && discSpeed > 0.025) {
        const fallback = direction(side, aim);
        const nx = distance > 0.0001 ? dx / distance : fallback.x;
        const ny = distance > 0.0001 ? dy / distance : fallback.y;
        disc.vx = 0;
        disc.vy = 0;
        ball.vx = 0;
        ball.vy = 0;
        ball.x = clamp(disc.x + nx * (DISC_RADIUS + BALL_RADIUS + 0.002), BALL_RADIUS, 1 - BALL_RADIUS);
        ball.y = clamp(disc.y + ny * (DISC_RADIUS + BALL_RADIUS + 0.002), 0.02, 0.98);
        return {
          discs: discs.map(({ vx: _vx, vy: _vy, ...item }) => item),
          ball: { x: ball.x, y: ball.y },
          caughtBy: disc.id,
          goalSide: null as Side | null,
        };
      }
      resolveBallCollision(disc, ball, kind === "kick" && disc.id === discId && step < 18);
    }

    const collisionGoal = goalFor(ball);
    if (collisionGoal) {
      return {
        discs: discs.map(({ vx: _vx, vy: _vy, ...disc }) => disc),
        ball: { x: ball.x, y: ball.y },
        caughtBy: null as string | null,
        goalSide: collisionGoal,
      };
    }

    for (const disc of discs) {
      disc.vx *= 0.974;
      disc.vy *= 0.974;
      if (Math.hypot(disc.vx, disc.vy) < 0.012) { disc.vx = 0; disc.vy = 0; }
    }
    ball.vx *= 0.978;
    ball.vy *= 0.978;
    if (Math.hypot(ball.vx, ball.vy) < 0.012) { ball.vx = 0; ball.vy = 0; }

    const stillMoving = Math.hypot(ball.vx, ball.vy) > 0 || discs.some((disc) => Math.hypot(disc.vx, disc.vy) > 0);
    if (!stillMoving && step > 10) break;
  }

  return {
    discs: discs.map(({ vx: _vx, vy: _vy, ...disc }) => disc),
    ball: { x: clamp(ball.x, BALL_RADIUS, 1 - BALL_RADIUS), y: clamp(ball.y, BALL_RADIUS, 1 - BALL_RADIUS) },
    caughtBy: null as string | null,
    goalSide: null as Side | null,
  };
}

async function onlinePlayers(code: string, hostUserId: string, count: number) {
  const result = await db().query<{ id: string; username: string }>(
    `select u.id,u.username
     from retro_room_members m
     join retro_users u on u.id=m.user_id
     where m.room_code=$1 and m.last_seen>now()-interval '15 seconds'
     order by case when u.id=$2 then 0 else 1 end,m.joined_at
     limit $3`,
    [code, hostUserId, count]
  );
  return result.rows;
}

export async function POST(req: NextRequest) {
  try {
    const data = await req.json().catch(() => ({}));
    const code = cleanRoomCode(data.code);
    if (code.length !== 5) throw new Error("Code de room invalide.");
    const action = String(data.action ?? "state");
    const user = await requireUser(req);
    const membership = await requireRoomMember(code, user);
    await ensureGame(code);

    if (action === "state") {
      return NextResponse.json({ ok: true, game: output(await gameRow(code)) });
    }

    if (action === "start") {
      if (membership.host_user_id !== user.id) throw new Error("Seul l'hôte peut lancer la partie.");
      const mode = Number(data.mode) === 2 ? 2 : 1;
      const targetScore = [1, 3, 5, 7, 9].includes(Number(data.targetScore)) ? Number(data.targetScore) : 3;
      const needed = mode * 2;
      const users = await onlinePlayers(code, user.id, needed);
      if (users.length < needed) throw new Error(mode === 2 ? "Il faut 4 joueurs en ligne pour lancer un 2v2." : "Il faut 2 joueurs en ligne pour lancer un 1v1.");
      const players: MatchPlayer[] = mode === 1
        ? [
            { userId: users[0].id, username: users[0].username, side: "blue" },
            { userId: users[1].id, username: users[1].username, side: "red" },
          ]
        : [
            { userId: users[0].id, username: users[0].username, side: "blue" },
            { userId: users[1].id, username: users[1].username, side: "blue" },
            { userId: users[2].id, username: users[2].username, side: "red" },
            { userId: users[3].id, username: users[3].username, side: "red" },
          ];
      const lastAction: LastAction = { type: "start", by: user.id, discId: null, caughtBy: null, goalSide: null, at: Date.now() };
      await db().query(
        `update retro_football_games
         set status='playing',mode=$1,players=$2::jsonb,discs=$3::jsonb,ball=$4::jsonb,turn_side='blue',moves_left=2,possession=null,
             blue_score=0,red_score=0,target_score=$5,winner_side=null,action_seq=action_seq+1,last_action=$6::jsonb,updated_at=now()
         where room_code=$7`,
        [mode, JSON.stringify(players), JSON.stringify(initialDiscs()), JSON.stringify(freshBall()), targetScore, JSON.stringify(lastAction), code]
      );
      return NextResponse.json({ ok: true, game: output(await gameRow(code)) });
    }

    if (action === "stop") {
      if (membership.host_user_id !== user.id) throw new Error("Seul l'hôte peut arrêter la partie.");
      const lastAction: LastAction = { type: "stop", by: user.id, discId: null, caughtBy: null, goalSide: null, at: Date.now() };
      await db().query(
        `update retro_football_games
         set status='lobby',players='[]'::jsonb,discs=$1::jsonb,ball=$2::jsonb,turn_side='blue',moves_left=2,possession=null,
             blue_score=0,red_score=0,winner_side=null,action_seq=action_seq+1,last_action=$3::jsonb,updated_at=now()
         where room_code=$4`,
        [JSON.stringify(initialDiscs()), JSON.stringify(freshBall()), JSON.stringify(lastAction), code]
      );
      return NextResponse.json({ ok: true, game: output(await gameRow(code)) });
    }

    if (action === "shot") {
      const aim = clamp(Number(data.aim) || 0, -1, 1);
      const power = clamp(Number(data.power) || 0, 0.15, 1);
      const requestedDiscId = String(data.discId ?? "");
      const client = await db().connect();
      try {
        await client.query("begin");
        const result = await client.query<Row>(
          `select room_code,status,mode,players,discs,ball,turn_side,moves_left,possession,blue_score,red_score,target_score,winner_side,action_seq::text,last_action
           from retro_football_games where room_code=$1 for update`,
          [code]
        );
        const locked = result.rows[0];
        if (!locked || locked.status !== "playing") throw new Error("La partie n'est pas en cours.");
        const players = parsePlayers(locked.players);
        const me = players.find((player) => player.userId === user.id);
        if (!me) throw new Error("Tu es spectateur de cette partie.");
        const turnSide: Side = locked.turn_side === "red" ? "red" : "blue";
        if (me.side !== turnSide) throw new Error("Ce n'est pas le tour de ton équipe.");

        const discs = parseDiscs(locked.discs);
        const ball = parseBall(locked.ball);
        const possession = parsePossession(locked.possession);
        const discId = possession?.discId || requestedDiscId;
        const disc = discs.find((item) => item.id === discId);
        if (!disc || disc.side !== turnSide) throw new Error("Choisis un joueur de ton équipe.");
        if (possession && (possession.side !== turnSide || requestedDiscId !== possession.discId)) throw new Error("La balle est collée : tu dois retirer avec ce joueur.");

        const kind: "move" | "kick" = possession ? "kick" : "move";
        const simulation = simulate(discs, ball, discId, turnSide, aim, power, kind);
        let nextDiscs = simulation.discs;
        let nextBall = simulation.ball;
        let nextPossession: Possession = simulation.caughtBy ? { discId: simulation.caughtBy, side: turnSide } : null;
        let movesLeft = Math.max(1, Math.min(2, Number(locked.moves_left) || 2));
        let nextTurn = turnSide;
        let blueScore = Math.max(0, Number(locked.blue_score) || 0);
        let redScore = Math.max(0, Number(locked.red_score) || 0);
        const targetScore = clamp(Math.trunc(Number(locked.target_score) || 3), 1, 9);
        let winnerSide: Side | null = null;

        if (simulation.goalSide) {
          if (simulation.goalSide === "blue") blueScore += 1;
          else redScore += 1;
          winnerSide = blueScore >= targetScore ? "blue" : redScore >= targetScore ? "red" : null;
          nextPossession = null;
          nextDiscs = initialDiscs();
          nextBall = freshBall();
          movesLeft = 2;
          nextTurn = winnerSide ? turnSide : opposite(simulation.goalSide);
        } else if (!simulation.caughtBy) {
          movesLeft -= 1;
          if (movesLeft <= 0) {
            movesLeft = 2;
            nextTurn = opposite(turnSide);
          }
        }

        const lastAction: LastAction = {
          type: simulation.goalSide ? "goal" : kind,
          by: user.id,
          discId,
          caughtBy: simulation.caughtBy,
          goalSide: simulation.goalSide,
          at: Date.now(),
        };
        await client.query(
          `update retro_football_games
           set status=$1,discs=$2::jsonb,ball=$3::jsonb,turn_side=$4,moves_left=$5,possession=$6::jsonb,
               blue_score=$7,red_score=$8,winner_side=$9,action_seq=action_seq+1,last_action=$10::jsonb,updated_at=now()
           where room_code=$11`,
          [winnerSide ? "gameover" : "playing", JSON.stringify(nextDiscs), JSON.stringify(nextBall), nextTurn, movesLeft,
           nextPossession ? JSON.stringify(nextPossession) : null, blueScore, redScore, winnerSide, JSON.stringify(lastAction), code]
        );
        await client.query("commit");
      } catch (error) {
        try { await client.query("rollback"); } catch {}
        throw error;
      } finally {
        client.release();
      }
      return NextResponse.json({ ok: true, game: output(await gameRow(code)) });
    }

    throw new Error("Action Foot inconnue.");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erreur Foot.";
    return NextResponse.json({ ok: false, error: message }, { status: message === "AUTH_REQUIRED" ? 401 : 400 });
  }
}
