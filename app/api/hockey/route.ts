import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { cleanup, db, ensureSchema } from "@/lib/db";
import { ensureHockeyV3Schema } from "@/lib/hockey-schema";
import { cleanRoomCode } from "@/lib/utils";
import { requireRoomMember } from "@/lib/room";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Mode = "1v1" | "2v2";
type Side = "left" | "right";
type HockeyPlayer = { userId: string; username: string; side: Side; slot: number };
type Paddle = { x: number; y: number; vx: number; vy: number };

type HockeyRow = {
  room_code: string;
  mode: Mode;
  status: "lobby" | "playing" | "gameover";
  authority_user_id: string | null;
  players: HockeyPlayer[];
  left_score: number;
  right_score: number;
  winner_side: Side | null;
};

type RuntimeRow = {
  puck_x: number;
  puck_y: number;
  puck_vx: number;
  puck_vy: number;
  paddles: Record<string, Paddle>;
  left_score: number;
  right_score: number;
  winner_side: Side | null;
  pause_until_ms: string | number;
  last_step_ms: string | number;
  version: string | number;
};

const PUCK_R = 0.024;
const MALLET_R = 0.052;
const LEFT_BOARD = 0.03;
const RIGHT_BOARD = 0.97;
const TOP_BOARD = 0.045;
const BOTTOM_BOARD = 0.955;
const GOAL_MIN = 0.36;
const GOAL_MAX = 0.64;
const MAX_PUCK_SPEED = 0.95;
const MAX_MALLET_SPEED = 1.25;

async function payload(req: NextRequest) {
  try { return await req.json(); } catch { return {}; }
}

async function getRoomHost(code: string) {
  const result = await db().query<{ host_user_id: string }>(
    `select host_user_id from retro_rooms where code = $1 and expires_at > now() limit 1`,
    [code]
  );
  if (!result.rows[0]) throw new Error("Room introuvable ou expirée.");
  return result.rows[0].host_user_id;
}

async function ensureGame(code: string) {
  await db().query(`insert into retro_hockey_games (room_code) values ($1) on conflict (room_code) do nothing`, [code]);
}

async function readGame(code: string): Promise<HockeyRow> {
  await ensureGame(code);
  const result = await db().query<HockeyRow>(
    `select room_code, mode, status, authority_user_id, players, left_score, right_score, winner_side
     from retro_hockey_games where room_code = $1 limit 1`,
    [code]
  );
  return result.rows[0];
}

function publicGame(row: HockeyRow) {
  return {
    mode: row.mode,
    status: row.status,
    authorityId: row.authority_user_id,
    players: Array.isArray(row.players) ? row.players : [],
    leftScore: row.left_score,
    rightScore: row.right_score,
    winnerSide: row.winner_side,
    targetScore: 7,
  };
}

function initialPaddle(player: HockeyPlayer, mode: Mode): Paddle {
  return {
    x: player.side === "left" ? 0.2 : 0.8,
    y: mode === "1v1" ? 0.5 : player.slot === 0 ? 0.34 : 0.66,
    vx: 0,
    vy: 0,
  };
}

function clampPaddle(side: Side, x: number, y: number) {
  return {
    x: Math.max(side === "left" ? 0.075 : 0.53, Math.min(side === "left" ? 0.47 : 0.925, x)),
    y: Math.max(0.085, Math.min(0.915, y)),
  };
}

async function connectedMembers(code: string) {
  const result = await db().query<{ id: string; username: string }>(
    `select u.id, u.username
     from retro_room_members m
     join retro_users u on u.id = m.user_id
     where m.room_code = $1 and m.last_seen > now() - interval '15 seconds'
     order by m.joined_at`,
    [code]
  );
  return result.rows;
}

async function resetRuntime(code: string, game: HockeyRow) {
  const paddles: Record<string, Paddle> = {};
  for (const player of game.players) paddles[player.userId] = initialPaddle(player, game.mode);
  const now = Date.now();
  await db().query(
    `insert into retro_hockey_runtime
      (room_code, puck_x, puck_y, puck_vx, puck_vy, paddles, left_score, right_score, winner_side, pause_until_ms, last_step_ms, version)
     values ($1, .5, .5, 0, 0, $2::jsonb, 0, 0, null, $3, $4, 1)
     on conflict (room_code) do update set
       puck_x=.5,puck_y=.5,puck_vx=0,puck_vy=0,paddles=excluded.paddles,
       left_score=0,right_score=0,winner_side=null,pause_until_ms=excluded.pause_until_ms,
       last_step_ms=excluded.last_step_ms,version=retro_hockey_runtime.version+1`,
    [code, JSON.stringify(paddles), now + 900, now]
  );
  await db().query(`delete from retro_hockey_inputs where room_code = $1`, [code]);
}

function frameFromRuntime(row: RuntimeRow) {
  return {
    puck: { x: Number(row.puck_x), y: Number(row.puck_y), vx: Number(row.puck_vx), vy: Number(row.puck_vy) },
    paddles: row.paddles ?? {},
    leftScore: Number(row.left_score),
    rightScore: Number(row.right_score),
    winnerSide: row.winner_side,
    pauseUntil: Number(row.pause_until_ms),
    version: Number(row.version),
  };
}

async function stepRuntime(code: string, game: HockeyRow) {
  const client = await db().connect();
  try {
    await client.query("begin");
    await client.query(`select pg_advisory_xact_lock(hashtext($1))`, [`retro-hockey:${code}`]);

    let runtimeResult = await client.query<RuntimeRow>(
      `select puck_x,puck_y,puck_vx,puck_vy,paddles,left_score,right_score,winner_side,pause_until_ms,last_step_ms,version
       from retro_hockey_runtime where room_code=$1 for update`,
      [code]
    );

    if (!runtimeResult.rows[0]) {
      await client.query("rollback");
      await resetRuntime(code, game);
      return stepRuntime(code, game);
    }

    const row = runtimeResult.rows[0];
    if (game.status === "gameover" || row.winner_side) {
      await client.query("commit");
      return frameFromRuntime(row);
    }

    const inputResult = await client.query<{
      user_id: string; x: number; y: number; vx: number; vy: number; age_ms: number;
    }>(
      `select user_id,x,y,vx,vy,
              extract(epoch from (now()-updated_at))*1000 as age_ms
       from retro_hockey_inputs where room_code=$1`,
      [code]
    );
    const inputs = new Map(inputResult.rows.map((r) => [r.user_id, r]));

    let puck = { x: Number(row.puck_x), y: Number(row.puck_y), vx: Number(row.puck_vx), vy: Number(row.puck_vy) };
    const paddles: Record<string, Paddle> = { ...(row.paddles ?? {}) };
    let leftScore = Number(row.left_score);
    let rightScore = Number(row.right_score);
    let winnerSide: Side | null = row.winner_side;
    let pauseUntil = Number(row.pause_until_ms);
    const now = Date.now();
    const elapsed = Math.max(0, Math.min(0.12, (now - Number(row.last_step_ms || now)) / 1000));
    const steps = Math.max(1, Math.min(16, Math.ceil(elapsed / (1 / 120))));
    const dt = steps > 0 ? elapsed / steps : 0;

    const targets = new Map<string, Paddle>();
    for (const player of game.players) {
      const base = paddles[player.userId] ?? initialPaddle(player, game.mode);
      const input = inputs.get(player.userId);
      if (input && Number(input.age_ms) < 1200) {
        const point = clampPaddle(player.side, Number(input.x), Number(input.y));
        targets.set(player.userId, {
          x: point.x,
          y: point.y,
          vx: Math.max(-MAX_MALLET_SPEED, Math.min(MAX_MALLET_SPEED, Number(input.vx) || 0)),
          vy: Math.max(-MAX_MALLET_SPEED, Math.min(MAX_MALLET_SPEED, Number(input.vy) || 0)),
        });
      } else {
        targets.set(player.userId, { ...base, vx: 0, vy: 0 });
      }
    }

    for (let step = 0; step < steps; step++) {
      const remaining = Math.max(1, steps - step);
      for (const player of game.players) {
        const pad = paddles[player.userId] ?? initialPaddle(player, game.mode);
        const target = targets.get(player.userId) ?? pad;
        pad.x += (target.x - pad.x) / remaining;
        pad.y += (target.y - pad.y) / remaining;
        pad.vx = target.vx;
        pad.vy = target.vy;
        paddles[player.userId] = pad;
      }

      if (!winnerSide && now >= pauseUntil && dt > 0) {
        puck.x += puck.vx * dt;
        puck.y += puck.vy * dt;
        const friction = Math.pow(0.995, dt * 60);
        puck.vx *= friction;
        puck.vy *= friction;
        if (Math.hypot(puck.vx, puck.vy) < 0.008) { puck.vx = 0; puck.vy = 0; }

        if (puck.y - PUCK_R < TOP_BOARD) { puck.y = TOP_BOARD + PUCK_R; puck.vy = Math.abs(puck.vy) * 0.98; }
        if (puck.y + PUCK_R > BOTTOM_BOARD) { puck.y = BOTTOM_BOARD - PUCK_R; puck.vy = -Math.abs(puck.vy) * 0.98; }

        const inGoalLane = puck.y > GOAL_MIN && puck.y < GOAL_MAX;
        if (!inGoalLane && puck.x - PUCK_R < LEFT_BOARD) { puck.x = LEFT_BOARD + PUCK_R; puck.vx = Math.abs(puck.vx) * 0.98; }
        if (!inGoalLane && puck.x + PUCK_R > RIGHT_BOARD) { puck.x = RIGHT_BOARD - PUCK_R; puck.vx = -Math.abs(puck.vx) * 0.98; }

        if (inGoalLane && puck.x < -0.02) {
          rightScore += 1;
          puck = { x: 0.5, y: 0.5, vx: 0, vy: 0 };
          pauseUntil = now + 950;
          if (rightScore >= 7) winnerSide = "right";
        } else if (inGoalLane && puck.x > 1.02) {
          leftScore += 1;
          puck = { x: 0.5, y: 0.5, vx: 0, vy: 0 };
          pauseUntil = now + 950;
          if (leftScore >= 7) winnerSide = "left";
        }

        for (const player of game.players) {
          const pad = paddles[player.userId];
          if (!pad) continue;
          const dx = puck.x - pad.x;
          const dy = puck.y - pad.y;
          const distance = Math.hypot(dx, dy);
          const minDistance = PUCK_R + MALLET_R;
          if (distance <= 0 || distance >= minDistance) continue;

          const nx = dx / distance;
          const ny = dy / distance;
          puck.x = pad.x + nx * minDistance;
          puck.y = pad.y + ny * minDistance;

          const relativeX = puck.vx - pad.vx;
          const relativeY = puck.vy - pad.vy;
          const toward = relativeX * nx + relativeY * ny;
          if (toward < 0) {
            puck.vx = relativeX - 2 * toward * nx + pad.vx * 0.52;
            puck.vy = relativeY - 2 * toward * ny + pad.vy * 0.52;
          } else {
            puck.vx += pad.vx * 0.34 + nx * 0.025;
            puck.vy += pad.vy * 0.34 + ny * 0.025;
          }

          const speed = Math.hypot(puck.vx, puck.vy);
          if (speed > MAX_PUCK_SPEED) {
            const ratio = MAX_PUCK_SPEED / speed;
            puck.vx *= ratio;
            puck.vy *= ratio;
          }
        }
      }
    }

    const version = Number(row.version) + 1;
    await client.query(
      `update retro_hockey_runtime set
         puck_x=$1,puck_y=$2,puck_vx=$3,puck_vy=$4,paddles=$5::jsonb,
         left_score=$6,right_score=$7,winner_side=$8,pause_until_ms=$9,last_step_ms=$10,version=$11
       where room_code=$12`,
      [puck.x,puck.y,puck.vx,puck.vy,JSON.stringify(paddles),leftScore,rightScore,winnerSide,pauseUntil,now,version,code]
    );

    await client.query(
      `update retro_hockey_games set left_score=$1,right_score=$2,winner_side=$3,
         status=case when $3::text is null then 'playing' else 'gameover' end,updated_at=now()
       where room_code=$4`,
      [leftScore,rightScore,winnerSide,code]
    );

    await client.query("commit");
    return {
      puck,
      paddles,
      leftScore,
      rightScore,
      winnerSide,
      pauseUntil,
      version,
    };
  } catch (error) {
    try { await client.query("rollback"); } catch {}
    throw error;
  } finally {
    client.release();
  }
}

export async function POST(req: NextRequest) {
  try {
    await ensureSchema();
    await ensureHockeyV3Schema();
    await cleanup();
    const user = await requireUser(req);
    const data = await payload(req);
    const code = cleanRoomCode(data.code);
    const action = String(data.action ?? "state");
    await requireRoomMember(code, user);
    await ensureGame(code);

    if (action === "state") {
      const game = await readGame(code);
      const runtime = await db().query<RuntimeRow>(
        `select puck_x,puck_y,puck_vx,puck_vy,paddles,left_score,right_score,winner_side,pause_until_ms,last_step_ms,version
         from retro_hockey_runtime where room_code=$1 limit 1`, [code]
      );
      return NextResponse.json({ ok: true, game: publicGame(game), frame: runtime.rows[0] ? frameFromRuntime(runtime.rows[0]) : null });
    }

    if (action === "configure") {
      const hostId = await getRoomHost(code);
      if (hostId !== user.id) throw new Error("Seul l'hôte peut modifier le mode.");
      const mode: Mode = data.mode === "2v2" ? "2v2" : "1v1";
      const row = await readGame(code);
      if (row.status === "playing") throw new Error("Impossible de changer le mode pendant un match.");
      await db().query(
        `update retro_hockey_games set mode=$1,status='lobby',authority_user_id=null,players='[]'::jsonb,
         left_score=0,right_score=0,winner_side=null,updated_at=now() where room_code=$2`, [mode,code]
      );
      await db().query(`delete from retro_hockey_inputs where room_code=$1`, [code]);
      return NextResponse.json({ ok:true, game: publicGame(await readGame(code)) });
    }

    if (action === "start") {
      const hostId = await getRoomHost(code);
      if (hostId !== user.id) throw new Error("Seul l'hôte peut lancer le match.");
      const current = await readGame(code);
      const needed = current.mode === "2v2" ? 4 : 2;
      const members = await connectedMembers(code);
      if (members.length < needed) throw new Error(current.mode === "2v2" ? "Il faut 4 joueurs connectés pour le 2v2." : "Il faut 2 joueurs connectés pour le 1v1.");
      const selected = members.slice(0, needed);
      const players: HockeyPlayer[] = selected.map((member,index) => ({
        userId: member.id,
        username: member.username,
        side: index % 2 === 0 ? "left" : "right",
        slot: current.mode === "2v2" ? Math.floor(index / 2) : 0,
      }));
      await db().query(
        `update retro_hockey_games set status='playing',authority_user_id=$1,players=$2::jsonb,
         left_score=0,right_score=0,winner_side=null,updated_at=now() where room_code=$3`,
        [hostId,JSON.stringify(players),code]
      );
      const started = await readGame(code);
      await resetRuntime(code, started);
      return NextResponse.json({ ok:true, game: publicGame(started) });
    }

    if (action === "input") {
      const game = await readGame(code);
      if (game.status !== "playing") throw new Error("Le match n'est pas en cours.");
      const player = game.players.find((p) => p.userId === user.id);
      if (!player) throw new Error("Tu es spectateur pour ce match.");
      const point = clampPaddle(player.side, Number(data.x), Number(data.y));
      const vx = Math.max(-MAX_MALLET_SPEED, Math.min(MAX_MALLET_SPEED, Number(data.vx) || 0));
      const vy = Math.max(-MAX_MALLET_SPEED, Math.min(MAX_MALLET_SPEED, Number(data.vy) || 0));
      await db().query(
        `insert into retro_hockey_inputs (room_code,user_id,x,y,vx,vy,updated_at)
         values ($1,$2,$3,$4,$5,$6,now())
         on conflict (room_code,user_id) do update set
           x=excluded.x,y=excluded.y,vx=excluded.vx,vy=excluded.vy,updated_at=now()`,
        [code,user.id,point.x,point.y,vx,vy]
      );
      return NextResponse.json({ ok:true });
    }

    if (action === "poll") {
      let game = await readGame(code);
      let frame = null;
      if (game.status === "playing" || game.status === "gameover") {
        frame = await stepRuntime(code, game);
        game = await readGame(code);
      }
      return NextResponse.json({ ok:true, game: publicGame(game), frame });
    }

    if (action === "stop") {
      const hostId = await getRoomHost(code);
      if (hostId !== user.id) throw new Error("Seul l'hôte peut arrêter le match.");
      await db().query(
        `update retro_hockey_games set status='lobby',authority_user_id=null,players='[]'::jsonb,
         left_score=0,right_score=0,winner_side=null,updated_at=now() where room_code=$1`, [code]
      );
      await db().query(`delete from retro_hockey_inputs where room_code=$1`, [code]);
      await db().query(`delete from retro_hockey_runtime where room_code=$1`, [code]);
      return NextResponse.json({ ok:true, game: publicGame(await readGame(code)) });
    }

    throw new Error("Action inconnue.");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erreur inconnue.";
    return NextResponse.json(
      { ok:false, error: message === "AUTH_REQUIRED" ? "Connexion requise." : message },
      { status: message === "AUTH_REQUIRED" ? 401 : 400 }
    );
  }
}
