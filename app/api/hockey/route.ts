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

type InputRow = {
  user_id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  age_ms: string | number;
};

const PUCK_R = 0.022;
const MALLET_R = 0.05;
const LEFT_BOARD = 0.025;
const RIGHT_BOARD = 0.975;
const TOP_BOARD = 0.04;
const BOTTOM_BOARD = 0.96;
const GOAL_MIN = 0.355;
const GOAL_MAX = 0.645;
const MAX_PUCK_SPEED = 0.9;
const MAX_MALLET_SPEED = 1.55;
const TARGET_SCORE = 7;
const INPUT_STALE_MS = 1200;

async function payload(req: NextRequest) {
  try { return await req.json(); } catch { return {}; }
}

function finite(value: unknown, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function capVector(x: number, y: number, max: number) {
  const speed = Math.hypot(x, y);
  if (speed <= max || speed <= 0.000001) return { x, y };
  const ratio = max / speed;
  return { x: x * ratio, y: y * ratio };
}

function initialPaddle(player: HockeyPlayer, mode: Mode): Paddle {
  return {
    x: player.side === "left" ? 0.2 : 0.8,
    y: mode === "1v1" ? 0.5 : player.slot === 0 ? 0.32 : 0.68,
    vx: 0,
    vy: 0,
  };
}

function clampPaddle(side: Side, x: number, y: number) {
  return {
    x: clamp(x, side === "left" ? 0.075 : 0.51, side === "left" ? 0.49 : 0.925),
    y: clamp(y, 0.085, 0.915),
  };
}

function publicGame(row: HockeyRow) {
  return {
    mode: row.mode,
    status: row.status,
    authorityId: row.authority_user_id,
    players: Array.isArray(row.players) ? row.players : [],
    leftScore: Number(row.left_score),
    rightScore: Number(row.right_score),
    winnerSide: row.winner_side,
    targetScore: TARGET_SCORE,
  };
}

function frameFromRuntime(row: RuntimeRow) {
  return {
    puck: {
      x: finite(row.puck_x, 0.5),
      y: finite(row.puck_y, 0.5),
      vx: finite(row.puck_vx),
      vy: finite(row.puck_vy),
    },
    paddles: row.paddles ?? {},
    leftScore: Number(row.left_score),
    rightScore: Number(row.right_score),
    winnerSide: row.winner_side,
    pauseUntil: Number(row.pause_until_ms),
    version: Number(row.version),
  };
}

async function getRoomHost(code: string) {
  const result = await db().query<{ host_user_id: string }>(
    `select host_user_id from retro_rooms where code=$1 and expires_at>now() limit 1`,
    [code]
  );
  if (!result.rows[0]) throw new Error("Room introuvable ou expirée.");
  return result.rows[0].host_user_id;
}

async function ensureGame(code: string) {
  await db().query(
    `insert into retro_hockey_games (room_code) values ($1) on conflict (room_code) do nothing`,
    [code]
  );
}

async function readGame(code: string): Promise<HockeyRow> {
  await ensureGame(code);
  const result = await db().query<HockeyRow>(
    `select room_code,mode,status,authority_user_id,players,left_score,right_score,winner_side
     from retro_hockey_games where room_code=$1 limit 1`,
    [code]
  );
  return result.rows[0];
}

async function connectedMembers(code: string) {
  const result = await db().query<{ id: string; username: string }>(
    `select u.id,u.username
     from retro_room_members m
     join retro_users u on u.id=m.user_id
     where m.room_code=$1 and m.last_seen>now()-interval '15 seconds'
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
       (room_code,puck_x,puck_y,puck_vx,puck_vy,paddles,left_score,right_score,winner_side,pause_until_ms,last_step_ms,version)
     values ($1,.5,.5,0,0,$2::jsonb,0,0,null,$3,$4,1)
     on conflict (room_code) do update set
       puck_x=.5,puck_y=.5,puck_vx=0,puck_vy=0,paddles=excluded.paddles,
       left_score=0,right_score=0,winner_side=null,pause_until_ms=excluded.pause_until_ms,
       last_step_ms=excluded.last_step_ms,version=retro_hockey_runtime.version+1`,
    [code, JSON.stringify(paddles), now + 800, now]
  );
  await db().query(`delete from retro_hockey_inputs where room_code=$1`, [code]);
}

function collidePaddle(
  puck: { x: number; y: number; vx: number; vy: number },
  oldPad: Paddle,
  pad: Paddle,
  side: Side,
) {
  const sx = pad.x - oldPad.x;
  const sy = pad.y - oldPad.y;
  const segmentLengthSq = sx * sx + sy * sy;
  let closestX = pad.x;
  let closestY = pad.y;

  if (segmentLengthSq > 0.0000001) {
    const t = clamp(((puck.x - oldPad.x) * sx + (puck.y - oldPad.y) * sy) / segmentLengthSq, 0, 1);
    closestX = oldPad.x + sx * t;
    closestY = oldPad.y + sy * t;
  }

  let dx = puck.x - closestX;
  let dy = puck.y - closestY;
  let distance = Math.hypot(dx, dy);
  const minDistance = PUCK_R + MALLET_R;
  if (distance >= minDistance) return;

  if (distance < 0.0001) {
    dx = side === "left" ? 1 : -1;
    dy = 0;
    distance = 1;
  }

  const nx = dx / distance;
  const ny = dy / distance;

  // Replace the puck just outside the current mallet so it cannot get stuck inside it.
  puck.x = pad.x + nx * minDistance;
  puck.y = pad.y + ny * minDistance;

  const relativeNormal = (puck.vx - pad.vx) * nx + (puck.vy - pad.vy) * ny;
  if (relativeNormal < 0) {
    puck.vx -= 1.65 * relativeNormal * nx;
    puck.vy -= 1.65 * relativeNormal * ny;
  }

  const strike = Math.max(0.1, pad.vx * nx + pad.vy * ny);
  puck.vx += pad.vx * 0.48 + nx * strike * 0.46;
  puck.vy += pad.vy * 0.48 + ny * strike * 0.46;

  const capped = capVector(puck.vx, puck.vy, MAX_PUCK_SPEED);
  puck.vx = capped.x;
  puck.vy = capped.y;
}

async function tickSharedGame(
  code: string,
  userId: string,
  input: { x: number; y: number; vx: number; vy: number } | null,
) {
  const client = await db().connect();
  try {
    await client.query("begin");
    await client.query(`select pg_advisory_xact_lock(hashtext($1))`, [`retro-hockey-v4:${code}`]);

    const gameResult = await client.query<HockeyRow>(
      `select room_code,mode,status,authority_user_id,players,left_score,right_score,winner_side
       from retro_hockey_games where room_code=$1 for update`,
      [code]
    );
    const game = gameResult.rows[0];
    if (!game) throw new Error("Partie introuvable.");

    const player = game.players.find((entry) => entry.userId === userId);
    if (input && player && game.status === "playing") {
      const point = clampPaddle(player.side, input.x, input.y);
      const velocity = capVector(input.vx, input.vy, MAX_MALLET_SPEED);
      await client.query(
        `insert into retro_hockey_inputs (room_code,user_id,x,y,vx,vy,updated_at)
         values ($1,$2,$3,$4,$5,$6,now())
         on conflict (room_code,user_id) do update set
           x=excluded.x,y=excluded.y,vx=excluded.vx,vy=excluded.vy,updated_at=now()`,
        [code, userId, point.x, point.y, velocity.x, velocity.y]
      );
    }

    if (game.status === "lobby") {
      await client.query("commit");
      return { game, frame: null };
    }

    let runtimeResult = await client.query<RuntimeRow>(
      `select puck_x,puck_y,puck_vx,puck_vy,paddles,left_score,right_score,winner_side,
              pause_until_ms,last_step_ms,version
       from retro_hockey_runtime where room_code=$1 for update`,
      [code]
    );

    if (!runtimeResult.rows[0]) {
      const paddles: Record<string, Paddle> = {};
      for (const entry of game.players) paddles[entry.userId] = initialPaddle(entry, game.mode);
      const now = Date.now();
      await client.query(
        `insert into retro_hockey_runtime
           (room_code,puck_x,puck_y,puck_vx,puck_vy,paddles,left_score,right_score,winner_side,pause_until_ms,last_step_ms,version)
         values ($1,.5,.5,0,0,$2::jsonb,$3,$4,$5,$6,$7,1)`,
        [code, JSON.stringify(paddles), game.left_score, game.right_score, game.winner_side, now + 700, now]
      );
      runtimeResult = await client.query<RuntimeRow>(
        `select puck_x,puck_y,puck_vx,puck_vy,paddles,left_score,right_score,winner_side,
                pause_until_ms,last_step_ms,version
         from retro_hockey_runtime where room_code=$1 for update`,
        [code]
      );
    }

    const row = runtimeResult.rows[0];
    if (game.status === "gameover" || row.winner_side) {
      await client.query("commit");
      return { game, frame: frameFromRuntime(row) };
    }

    const inputsResult = await client.query<InputRow>(
      `select user_id,x,y,vx,vy,extract(epoch from (now()-updated_at))*1000 as age_ms
       from retro_hockey_inputs where room_code=$1`,
      [code]
    );
    const inputs = new Map(inputsResult.rows.map((entry) => [entry.user_id, entry]));

    const puck = {
      x: finite(row.puck_x, 0.5),
      y: finite(row.puck_y, 0.5),
      vx: finite(row.puck_vx),
      vy: finite(row.puck_vy),
    };
    const paddles: Record<string, Paddle> = { ...(row.paddles ?? {}) };
    let leftScore = Number(row.left_score);
    let rightScore = Number(row.right_score);
    let winnerSide: Side | null = row.winner_side;
    let pauseUntil = Number(row.pause_until_ms);

    const now = Date.now();
    const previousStep = Number(row.last_step_ms) || now;
    const elapsed = clamp((now - previousStep) / 1000, 0, 0.09);

    // If two players poll at almost exactly the same instant, keep the accumulated time
    // instead of resetting the physics clock with a meaningless zero-length step.
    if (elapsed < 0.003) {
      await client.query("commit");
      return { game, frame: frameFromRuntime(row) };
    }

    const steps = clamp(Math.ceil(elapsed / (1 / 120)), 1, 14);
    const dt = elapsed / steps;
    const targets = new Map<string, Paddle>();

    for (const hockeyPlayer of game.players) {
      const current = paddles[hockeyPlayer.userId] ?? initialPaddle(hockeyPlayer, game.mode);
      const latest = inputs.get(hockeyPlayer.userId);
      if (latest && Number(latest.age_ms) < INPUT_STALE_MS) {
        const point = clampPaddle(hockeyPlayer.side, finite(latest.x, current.x), finite(latest.y, current.y));
        const velocity = capVector(finite(latest.vx), finite(latest.vy), MAX_MALLET_SPEED);
        targets.set(hockeyPlayer.userId, { x: point.x, y: point.y, vx: velocity.x, vy: velocity.y });
      } else {
        targets.set(hockeyPlayer.userId, { ...current, vx: 0, vy: 0 });
      }
    }

    for (let step = 0; step < steps; step++) {
      const oldPaddles: Record<string, Paddle> = {};
      const remaining = Math.max(1, steps - step);

      for (const hockeyPlayer of game.players) {
        const pad = paddles[hockeyPlayer.userId] ?? initialPaddle(hockeyPlayer, game.mode);
        oldPaddles[hockeyPlayer.userId] = { ...pad };
        const target = targets.get(hockeyPlayer.userId) ?? pad;
        const nextX = pad.x + (target.x - pad.x) / remaining;
        const nextY = pad.y + (target.y - pad.y) / remaining;
        const calculated = capVector((nextX - pad.x) / dt, (nextY - pad.y) / dt, MAX_MALLET_SPEED);
        pad.x = nextX;
        pad.y = nextY;
        pad.vx = Math.abs(target.vx) > Math.abs(calculated.x) ? target.vx : calculated.x;
        pad.vy = Math.abs(target.vy) > Math.abs(calculated.y) ? target.vy : calculated.y;
        const cappedPad = capVector(pad.vx, pad.vy, MAX_MALLET_SPEED);
        pad.vx = cappedPad.x;
        pad.vy = cappedPad.y;
        paddles[hockeyPlayer.userId] = pad;
      }

      if (!winnerSide && now >= pauseUntil) {
        puck.x += puck.vx * dt;
        puck.y += puck.vy * dt;

        const friction = Math.pow(0.994, dt * 60);
        puck.vx *= friction;
        puck.vy *= friction;
        if (Math.hypot(puck.vx, puck.vy) < 0.006) {
          puck.vx = 0;
          puck.vy = 0;
        }

        if (puck.y - PUCK_R < TOP_BOARD) {
          puck.y = TOP_BOARD + PUCK_R;
          puck.vy = Math.abs(puck.vy) * 0.97;
        }
        if (puck.y + PUCK_R > BOTTOM_BOARD) {
          puck.y = BOTTOM_BOARD - PUCK_R;
          puck.vy = -Math.abs(puck.vy) * 0.97;
        }

        const inGoalLane = puck.y > GOAL_MIN && puck.y < GOAL_MAX;
        if (!inGoalLane && puck.x - PUCK_R < LEFT_BOARD) {
          puck.x = LEFT_BOARD + PUCK_R;
          puck.vx = Math.abs(puck.vx) * 0.97;
        }
        if (!inGoalLane && puck.x + PUCK_R > RIGHT_BOARD) {
          puck.x = RIGHT_BOARD - PUCK_R;
          puck.vx = -Math.abs(puck.vx) * 0.97;
        }

        if (inGoalLane && puck.x < -0.025) {
          rightScore += 1;
          puck.x = 0.5; puck.y = 0.5; puck.vx = 0; puck.vy = 0;
          pauseUntil = now + 850;
          if (rightScore >= TARGET_SCORE) winnerSide = "right";
        } else if (inGoalLane && puck.x > 1.025) {
          leftScore += 1;
          puck.x = 0.5; puck.y = 0.5; puck.vx = 0; puck.vy = 0;
          pauseUntil = now + 850;
          if (leftScore >= TARGET_SCORE) winnerSide = "left";
        }

        for (const hockeyPlayer of game.players) {
          const pad = paddles[hockeyPlayer.userId];
          const oldPad = oldPaddles[hockeyPlayer.userId] ?? pad;
          if (pad) collidePaddle(puck, oldPad, pad, hockeyPlayer.side);
        }
      }
    }

    const version = Number(row.version) + 1;
    await client.query(
      `update retro_hockey_runtime set
         puck_x=$1,puck_y=$2,puck_vx=$3,puck_vy=$4,paddles=$5::jsonb,
         left_score=$6,right_score=$7,winner_side=$8,pause_until_ms=$9,last_step_ms=$10,version=$11
       where room_code=$12`,
      [puck.x, puck.y, puck.vx, puck.vy, JSON.stringify(paddles), leftScore, rightScore, winnerSide, pauseUntil, now, version, code]
    );

    await client.query(
      `update retro_hockey_games set left_score=$1,right_score=$2,winner_side=$3,
         status=case when $3::text is null then 'playing' else 'gameover' end,updated_at=now()
       where room_code=$4`,
      [leftScore, rightScore, winnerSide, code]
    );

    const updatedGame: HockeyRow = {
      ...game,
      left_score: leftScore,
      right_score: rightScore,
      winner_side: winnerSide,
      status: winnerSide ? "gameover" : "playing",
    };

    await client.query("commit");
    return {
      game: updatedGame,
      frame: {
        puck,
        paddles,
        leftScore,
        rightScore,
        winnerSide,
        pauseUntil,
        version,
      },
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
    const action = String(data.action ?? "tick");

    await requireRoomMember(code, user);
    await ensureGame(code);

    if (action === "state") {
      const game = await readGame(code);
      const runtime = await db().query<RuntimeRow>(
        `select puck_x,puck_y,puck_vx,puck_vy,paddles,left_score,right_score,winner_side,
                pause_until_ms,last_step_ms,version
         from retro_hockey_runtime where room_code=$1 limit 1`,
        [code]
      );
      return NextResponse.json({
        ok: true,
        game: publicGame(game),
        frame: runtime.rows[0] ? frameFromRuntime(runtime.rows[0]) : null,
      });
    }

    if (action === "configure") {
      const hostId = await getRoomHost(code);
      if (hostId !== user.id) throw new Error("Seul l'hôte peut modifier le mode.");
      const mode: Mode = data.mode === "2v2" ? "2v2" : "1v1";
      const game = await readGame(code);
      if (game.status === "playing") throw new Error("Impossible de changer le mode pendant un match.");

      await db().query(
        `update retro_hockey_games set
           mode=$1,status='lobby',authority_user_id=null,players='[]'::jsonb,
           left_score=0,right_score=0,winner_side=null,updated_at=now()
         where room_code=$2`,
        [mode, code]
      );
      await db().query(`delete from retro_hockey_inputs where room_code=$1`, [code]);
      await db().query(`delete from retro_hockey_runtime where room_code=$1`, [code]);
      return NextResponse.json({ ok: true, game: publicGame(await readGame(code)), frame: null });
    }

    if (action === "start") {
      const hostId = await getRoomHost(code);
      if (hostId !== user.id) throw new Error("Seul l'hôte peut lancer le match.");
      const current = await readGame(code);
      const needed = current.mode === "2v2" ? 4 : 2;
      const members = await connectedMembers(code);
      if (members.length < needed) {
        throw new Error(current.mode === "2v2" ? "Il faut 4 joueurs connectés pour le 2v2." : "Il faut 2 joueurs connectés pour le 1v1.");
      }

      const selected = members.slice(0, needed);
      const players: HockeyPlayer[] = selected.map((member, index) => ({
        userId: member.id,
        username: member.username,
        side: index % 2 === 0 ? "left" : "right",
        slot: current.mode === "2v2" ? Math.floor(index / 2) : 0,
      }));

      await db().query(
        `update retro_hockey_games set
           status='playing',authority_user_id=$1,players=$2::jsonb,
           left_score=0,right_score=0,winner_side=null,updated_at=now()
         where room_code=$3`,
        [hostId, JSON.stringify(players), code]
      );

      const started = await readGame(code);
      await resetRuntime(code, started);
      const runtime = await db().query<RuntimeRow>(
        `select puck_x,puck_y,puck_vx,puck_vy,paddles,left_score,right_score,winner_side,
                pause_until_ms,last_step_ms,version
         from retro_hockey_runtime where room_code=$1 limit 1`,
        [code]
      );

      return NextResponse.json({
        ok: true,
        game: publicGame(started),
        frame: runtime.rows[0] ? frameFromRuntime(runtime.rows[0]) : null,
      });
    }

    if (action === "tick") {
      const current = await readGame(code);
      const player = current.players.find((entry) => entry.userId === user.id);
      const hasInput = current.status === "playing" && Boolean(player) && data.x !== undefined && data.y !== undefined;
      const input = hasInput ? {
        x: finite(data.x, 0.5),
        y: finite(data.y, 0.5),
        vx: finite(data.vx),
        vy: finite(data.vy),
      } : null;

      const result = await tickSharedGame(code, user.id, input);
      return NextResponse.json({
        ok: true,
        game: publicGame(result.game),
        frame: result.frame,
      });
    }

    if (action === "stop") {
      const hostId = await getRoomHost(code);
      if (hostId !== user.id) throw new Error("Seul l'hôte peut arrêter le match.");
      await db().query(
        `update retro_hockey_games set
           status='lobby',authority_user_id=null,players='[]'::jsonb,
           left_score=0,right_score=0,winner_side=null,updated_at=now()
         where room_code=$1`,
        [code]
      );
      await db().query(`delete from retro_hockey_inputs where room_code=$1`, [code]);
      await db().query(`delete from retro_hockey_runtime where room_code=$1`, [code]);
      return NextResponse.json({ ok: true, game: publicGame(await readGame(code)), frame: null });
    }

    throw new Error("Action inconnue.");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erreur inconnue.";
    return NextResponse.json(
      { ok: false, error: message === "AUTH_REQUIRED" ? "Connexion requise." : message },
      { status: message === "AUTH_REQUIRED" ? 401 : 400 }
    );
  }
}
