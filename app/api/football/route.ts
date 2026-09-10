import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { requireRoomMember } from "@/lib/room";
import { cleanRoomCode } from "@/lib/utils";
import {
  FOOTBALL_BALL_RADIUS,
  FOOTBALL_DISC_RADIUS,
  freshFootballBall,
  footballAimForTarget,
  initialFootballDiscs,
  simulateFootballShot,
  type FootballBall,
  type FootballDisc,
  type FootballSide,
} from "@/lib/football-physics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type MatchPlayer = { userId: string; username: string; side: FootballSide; isBot?: boolean };
type LastAction = { type: "start" | "move" | "goal" | "stop"; by: string | null; discId: string | null; goalSide: FootballSide | null; at: number };
type Row = {
  room_code: string;
  status: "lobby" | "playing" | "gameover";
  mode: number;
  players: unknown;
  discs: unknown;
  ball: unknown;
  turn_side: FootballSide;
  moves_left: number;
  possession: unknown;
  blue_score: number;
  red_score: number;
  target_score: number;
  winner_side: FootballSide | null;
  action_seq: string | number;
  last_action: unknown;
};

const BOT_PREFIX = "__football_bot_";
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const opposite = (side: FootballSide): FootballSide => side === "blue" ? "red" : "blue";

function parsePlayers(value: unknown): MatchPlayer[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const raw = entry as Partial<MatchPlayer>;
    if (!raw.userId || !raw.username || (raw.side !== "blue" && raw.side !== "red")) return [];
    return [{ userId: String(raw.userId), username: String(raw.username), side: raw.side, isBot: Boolean(raw.isBot) }];
  });
}

function parseDiscs(value: unknown): FootballDisc[] {
  if (!Array.isArray(value)) return initialFootballDiscs();
  const parsed = value.flatMap((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const raw = entry as Partial<FootballDisc>;
    if (!raw.id || (raw.side !== "blue" && raw.side !== "red")) return [];
    return [{
      id: String(raw.id), side: raw.side,
      x: clamp(Number(raw.x) || 0.5, FOOTBALL_DISC_RADIUS, 1 - FOOTBALL_DISC_RADIUS),
      y: clamp(Number(raw.y) || 0.5, FOOTBALL_DISC_RADIUS, 1 - FOOTBALL_DISC_RADIUS),
    }];
  });
  return parsed.length === 10 ? parsed : initialFootballDiscs();
}

function parseBall(value: unknown): FootballBall {
  if (!value || typeof value !== "object" || Array.isArray(value)) return freshFootballBall();
  const raw = value as Partial<FootballBall>;
  return {
    x: clamp(Number(raw.x) || 0.5, -0.08, 1.08),
    y: clamp(Number(raw.y) || 0.5, -0.08, 1.08),
  };
}

let schemaPromise: Promise<void> | null = null;
async function ensureSchema() {
  if (!schemaPromise) {
    schemaPromise = db().query(`
      create table if not exists retro_football_games (
        room_code text primary key references retro_rooms(code) on delete cascade,
        status text not null default 'lobby', mode integer not null default 1,
        players jsonb not null default '[]'::jsonb, discs jsonb not null default '[]'::jsonb,
        ball jsonb not null default '{"x":0.5,"y":0.5}'::jsonb,
        turn_side text not null default 'blue', moves_left integer not null default 2,
        possession jsonb, blue_score integer not null default 0, red_score integer not null default 0,
        target_score integer not null default 3, winner_side text,
        action_seq bigint not null default 0, last_action jsonb, updated_at timestamptz not null default now()
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
    `).then(() => undefined).catch((error) => { schemaPromise = null; throw error; });
  }
  await schemaPromise;
}

async function ensureGame(code: string) {
  await ensureSchema();
  await db().query(
    `insert into retro_football_games (room_code,discs) values ($1,$2::jsonb) on conflict (room_code) do nothing`,
    [code, JSON.stringify(initialFootballDiscs())],
  );
}

async function gameRow(code: string, client = db()) {
  await ensureGame(code);
  const result = await client.query<Row>(
    `select room_code,status,mode,players,discs,ball,turn_side,moves_left,possession,blue_score,red_score,target_score,winner_side,action_seq::text,last_action
     from retro_football_games where room_code=$1 limit 1`,
    [code],
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
    movesLeft: clamp(Math.trunc(Number(row.moves_left) || 2), 1, 2),
    possession: null,
    blueScore: Math.max(0, Number(row.blue_score) || 0),
    redScore: Math.max(0, Number(row.red_score) || 0),
    targetScore: clamp(Math.trunc(Number(row.target_score) || 3), 1, 9),
    winnerSide: row.winner_side === "blue" || row.winner_side === "red" ? row.winner_side : null,
    actionSeq: Math.max(0, Number(row.action_seq) || 0),
  };
}

async function onlinePlayers(code: string, hostUserId: string) {
  const result = await db().query<{ id: string; username: string }>(
    `select u.id,u.username
     from retro_room_members m join retro_users u on u.id=m.user_id
     where m.room_code=$1 and m.last_seen>now()-interval '15 seconds'
     order by case when u.id=$2 then 0 else 1 end,m.joined_at`,
    [code, hostUserId],
  );
  return result.rows;
}

function botPlayers(mode: 1 | 2, humans: { id: string; username: string }[], fillBots: boolean) {
  const slots = mode === 1 ? 2 : 4;
  if (!fillBots && humans.length < slots) {
    throw new Error(mode === 2 ? "Il faut 4 joueurs en ligne, ou active « Compléter avec des bots »." : "Il faut 2 joueurs en ligne, ou active « Compléter avec un bot ». ");
  }
  const sides: FootballSide[] = mode === 1 ? ["blue", "red"] : ["blue", "red", "blue", "red"];
  return sides.map((side, index): MatchPlayer => {
    const human = humans[index];
    return human
      ? { userId: human.id, username: human.username, side }
      : { userId: `${BOT_PREFIX}${index}__`, username: `BOT ${index + 1}`, side, isBot: true };
  });
}

function wrapAim(value: number) {
  let result = value;
  while (result > 1) result -= 2;
  while (result < -1) result += 2;
  return result;
}

function chooseBotShot(row: Row) {
  const side: FootballSide = row.turn_side === "red" ? "red" : "blue";
  const discs = parseDiscs(row.discs);
  const ball = parseBall(row.ball);
  const own = discs.filter((disc) => disc.side === side);
  if (!own.length) throw new Error("Aucun pion bot.");

  let best: { discId: string; aim: number; power: number; score: number } | null = null;
  for (const disc of own) {
    const directAim = footballAimForTarget(side, disc, ball);
    for (const offset of [-0.075, 0, 0.075]) {
      const aim = wrapAim(directAim + offset);
      for (const power of [0.66, 0.84, 1]) {
        const simulation = simulateFootballShot(discs, ball, disc.id, side, aim, power);
        const progress = side === "blue" ? 1 - simulation.ball.y : simulation.ball.y;
        const center = 1 - Math.min(1, Math.abs(simulation.ball.x - 0.5) * 2.2);
        const moved = Math.hypot(simulation.ball.x - ball.x, simulation.ball.y - ball.y);
        const goalScore = simulation.goalSide === side ? 5000 : simulation.goalSide ? -5000 : 0;
        const score = goalScore + progress * 16 + center * 3 + moved * 7 - Math.hypot(disc.x - ball.x, disc.y - ball.y) * 0.7;
        if (!best || score > best.score) best = { discId: disc.id, aim, power, score };
      }
    }
  }

  return best ?? { discId: own[0].id, aim: footballAimForTarget(side, own[0], ball), power: 0.9, score: 0 };
}

async function applyShot(code: string, actorId: string, actorSide: FootballSide, requestedDiscId: string, aim: number, power: number) {
  const client = await db().connect();
  try {
    await client.query("begin");
    const result = await client.query<Row>(
      `select room_code,status,mode,players,discs,ball,turn_side,moves_left,possession,blue_score,red_score,target_score,winner_side,action_seq::text,last_action
       from retro_football_games where room_code=$1 for update`,
      [code],
    );
    const locked = result.rows[0];
    if (!locked || locked.status !== "playing") throw new Error("La partie n'est pas en cours.");
    const turnSide: FootballSide = locked.turn_side === "red" ? "red" : "blue";
    if (actorSide !== turnSide) throw new Error("Ce n'est pas le tour de cette équipe.");

    const discs = parseDiscs(locked.discs);
    const ball = parseBall(locked.ball);
    const disc = discs.find((item) => item.id === requestedDiscId && item.side === turnSide);
    if (!disc) throw new Error("Choisis un pion de ton équipe.");

    const simulation = simulateFootballShot(discs, ball, disc.id, turnSide, clamp(aim, -1, 1), clamp(power, 0.10, 1));
    let nextDiscs = simulation.discs;
    let nextBall = simulation.ball;
    let movesLeft = clamp(Math.trunc(Number(locked.moves_left) || 2), 1, 2) - 1;
    let nextTurn = turnSide;
    let blueScore = Math.max(0, Number(locked.blue_score) || 0);
    let redScore = Math.max(0, Number(locked.red_score) || 0);
    const targetScore = clamp(Math.trunc(Number(locked.target_score) || 3), 1, 9);
    let winnerSide: FootballSide | null = null;

    if (simulation.goalSide) {
      if (simulation.goalSide === "blue") blueScore += 1; else redScore += 1;
      winnerSide = blueScore >= targetScore ? "blue" : redScore >= targetScore ? "red" : null;
      nextDiscs = initialFootballDiscs();
      nextBall = freshFootballBall();
      movesLeft = 2;
      nextTurn = winnerSide ? turnSide : opposite(simulation.goalSide);
    } else if (movesLeft <= 0) {
      movesLeft = 2;
      nextTurn = opposite(turnSide);
    }

    const lastAction: LastAction = {
      type: simulation.goalSide ? "goal" : "move",
      by: actorId,
      discId: disc.id,
      goalSide: simulation.goalSide,
      at: Date.now(),
    };

    await client.query(
      `update retro_football_games
       set status=$1,discs=$2::jsonb,ball=$3::jsonb,turn_side=$4,moves_left=$5,possession=null,
           blue_score=$6,red_score=$7,winner_side=$8,action_seq=action_seq+1,last_action=$9::jsonb,updated_at=now()
       where room_code=$10`,
      [winnerSide ? "gameover" : "playing", JSON.stringify(nextDiscs), JSON.stringify(nextBall), nextTurn, movesLeft, blueScore, redScore, winnerSide, JSON.stringify(lastAction), code],
    );
    await client.query("commit");
  } catch (error) {
    try { await client.query("rollback"); } catch {}
    throw error;
  } finally {
    client.release();
  }
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

    if (action === "state") return NextResponse.json({ ok: true, game: output(await gameRow(code)) });

    if (action === "start") {
      if (membership.host_user_id !== user.id) throw new Error("Seul l'hôte peut lancer la partie.");
      const mode: 1 | 2 = Number(data.mode) === 2 ? 2 : 1;
      const targetScore = [1, 3, 5, 7, 9].includes(Number(data.targetScore)) ? Number(data.targetScore) : 3;
      const humans = await onlinePlayers(code, user.id);
      const players = botPlayers(mode, humans, Boolean(data.fillBots));
      const lastAction: LastAction = { type: "start", by: user.id, discId: null, goalSide: null, at: Date.now() };
      await db().query(
        `update retro_football_games
         set status='playing',mode=$1,players=$2::jsonb,discs=$3::jsonb,ball=$4::jsonb,turn_side='blue',moves_left=2,
             possession=null,blue_score=0,red_score=0,target_score=$5,winner_side=null,action_seq=action_seq+1,last_action=$6::jsonb,updated_at=now()
         where room_code=$7`,
        [mode, JSON.stringify(players), JSON.stringify(initialFootballDiscs()), JSON.stringify(freshFootballBall()), targetScore, JSON.stringify(lastAction), code],
      );
      return NextResponse.json({ ok: true, game: output(await gameRow(code)) });
    }

    if (action === "stop") {
      if (membership.host_user_id !== user.id) throw new Error("Seul l'hôte peut arrêter la partie.");
      const lastAction: LastAction = { type: "stop", by: user.id, discId: null, goalSide: null, at: Date.now() };
      await db().query(
        `update retro_football_games
         set status='lobby',players='[]'::jsonb,discs=$1::jsonb,ball=$2::jsonb,turn_side='blue',moves_left=2,
             possession=null,blue_score=0,red_score=0,winner_side=null,action_seq=action_seq+1,last_action=$3::jsonb,updated_at=now()
         where room_code=$4`,
        [JSON.stringify(initialFootballDiscs()), JSON.stringify(freshFootballBall()), JSON.stringify(lastAction), code],
      );
      return NextResponse.json({ ok: true, game: output(await gameRow(code)) });
    }

    if (action === "shot") {
      const current = await gameRow(code);
      const players = parsePlayers(current.players);
      const me = players.find((player) => player.userId === user.id && !player.isBot);
      if (!me) throw new Error("Tu es spectateur de cette partie.");
      await applyShot(code, user.id, me.side, String(data.discId ?? ""), Number(data.aim) || 0, Number(data.power) || 0);
      return NextResponse.json({ ok: true, game: output(await gameRow(code)) });
    }

    if (action === "botTick") {
      if (membership.host_user_id !== user.id) throw new Error("Seul l'hôte synchronise les bots.");
      const current = await gameRow(code);
      if (current.status !== "playing") return NextResponse.json({ ok: true, changed: false, game: output(current) });
      const players = parsePlayers(current.players);
      const side: FootballSide = current.turn_side === "red" ? "red" : "blue";
      const sidePlayers = players.filter((player) => player.side === side);
      if (sidePlayers.some((player) => !player.isBot)) return NextResponse.json({ ok: true, changed: false, game: output(current) });
      const bot = sidePlayers.find((player) => player.isBot);
      if (!bot) return NextResponse.json({ ok: true, changed: false, game: output(current) });
      const choice = chooseBotShot(current);
      await applyShot(code, bot.userId, side, choice.discId, choice.aim, choice.power);
      return NextResponse.json({ ok: true, changed: true, game: output(await gameRow(code)) });
    }

    throw new Error("Action Foot inconnue.");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erreur Foot.";
    return NextResponse.json({ ok: false, error: message }, { status: message === "AUTH_REQUIRED" ? 401 : 400 });
  }
}
