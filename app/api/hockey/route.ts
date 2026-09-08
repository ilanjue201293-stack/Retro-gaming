import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { db, ensureSchema } from "@/lib/db";
import { cleanRoomCode } from "@/lib/utils";
import { requireRoomMember } from "@/lib/room";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Mode = "1v1" | "2v2";
type Side = "left" | "right";
type HockeyPlayer = { userId: string; username: string; side: Side; slot: number };
type Paddle = { x: number; y: number; vx: number; vy: number };
type Frame = {
  puck: { x: number; y: number; vx: number; vy: number };
  paddles: Record<string, Paddle>;
  leftScore: number;
  rightScore: number;
  winnerSide: Side | null;
  pauseUntil: number;
};
type Input = Paddle & { at: number };
type Stored = { roster: HockeyPlayer[]; frame: Frame | null; inputs: Record<string, Input>; lastTick: number };
type Row = {
  room_code: string;
  mode: Mode;
  status: "lobby" | "playing" | "gameover";
  players: unknown;
  left_score: number;
  right_score: number;
  winner_side: Side | null;
};

const PUCK_R = 0.024;
const MALLET_R = 0.052;
const LEFT = 0.03;
const RIGHT = 0.97;
const TOP = 0.045;
const BOTTOM = 0.955;
const GOAL_MIN = 0.36;
const GOAL_MAX = 0.64;
const MAX_PUCK = 0.82;
const MAX_MALLET = 1.25;
const TARGET = 7;

async function body(req: NextRequest) {
  try { return await req.json(); } catch { return {}; }
}
function clamp(n: number, min: number, max: number) { return Math.max(min, Math.min(max, n)); }
function finite(n: unknown, fallback = 0) { const v = Number(n); return Number.isFinite(v) ? v : fallback; }
function cap(x: number, y: number, max: number) {
  const s = Math.hypot(x, y);
  if (!Number.isFinite(s) || s <= 0.000001) return { x: 0, y: 0 };
  if (s <= max) return { x, y };
  const k = max / s;
  return { x: x * k, y: y * k };
}
function initial(player: HockeyPlayer, mode: Mode): Paddle {
  return { x: player.side === "left" ? 0.2 : 0.8, y: mode === "1v1" ? 0.5 : player.slot === 0 ? 0.34 : 0.66, vx: 0, vy: 0 };
}
function clampPad(side: Side, x: number, y: number) {
  return {
    x: clamp(x, side === "left" ? 0.075 : 0.53, side === "left" ? 0.47 : 0.925),
    y: clamp(y, 0.085, 0.915),
  };
}
function fresh(roster: HockeyPlayer[], mode: Mode, now: number, leftScore = 0, rightScore = 0, winnerSide: Side | null = null): Frame {
  return {
    puck: { x: 0.5, y: 0.5, vx: 0, vy: 0 },
    paddles: Object.fromEntries(roster.map((p) => [p.userId, initial(p, mode)])),
    leftScore,
    rightScore,
    winnerSide,
    pauseUntil: now + 650,
  };
}
function decode(raw: unknown, mode: Mode, row: Row): Stored {
  const now = Date.now();
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const value = raw as Partial<Stored>;
    if (Array.isArray(value.roster)) {
      return {
        roster: value.roster as HockeyPlayer[],
        frame: value.frame && typeof value.frame === "object" ? value.frame as Frame : null,
        inputs: value.inputs && typeof value.inputs === "object" ? value.inputs as Record<string, Input> : {},
        lastTick: finite(value.lastTick, now),
      };
    }
  }
  if (Array.isArray(raw)) {
    const roster = raw as HockeyPlayer[];
    return {
      roster,
      frame: row.status === "playing" || row.status === "gameover" ? fresh(roster, mode, now, row.left_score, row.right_score, row.winner_side) : null,
      inputs: {},
      lastTick: now,
    };
  }
  return { roster: [], frame: null, inputs: {}, lastTick: now };
}
function publicGame(row: Row, stored: Stored) {
  return {
    mode: row.mode,
    status: row.status,
    players: stored.roster,
    leftScore: stored.frame?.leftScore ?? Number(row.left_score || 0),
    rightScore: stored.frame?.rightScore ?? Number(row.right_score || 0),
    winnerSide: stored.frame?.winnerSide ?? row.winner_side,
    targetScore: TARGET,
    frame: stored.frame,
  };
}

function collideSwept(frame: Frame, oldPad: Paddle, pad: Paddle, side: Side) {
  const sx = pad.x - oldPad.x;
  const sy = pad.y - oldPad.y;
  const seg = sx * sx + sy * sy;
  let cx = pad.x;
  let cy = pad.y;
  if (seg > 0.0000001) {
    const t = clamp(((frame.puck.x - oldPad.x) * sx + (frame.puck.y - oldPad.y) * sy) / seg, 0, 1);
    cx = oldPad.x + sx * t;
    cy = oldPad.y + sy * t;
  }
  let dx = frame.puck.x - cx;
  let dy = frame.puck.y - cy;
  let d = Math.hypot(dx, dy);
  const minD = PUCK_R + MALLET_R;
  if (d >= minD) return;
  if (d < 0.0001) { dx = side === "left" ? 1 : -1; dy = 0; d = 1; }
  const nx = dx / d;
  const ny = dy / d;
  frame.puck.x = pad.x + nx * minD;
  frame.puck.y = pad.y + ny * minD;
  const rel = (frame.puck.vx - pad.vx) * nx + (frame.puck.vy - pad.vy) * ny;
  if (rel < 0) {
    frame.puck.vx -= 1.55 * rel * nx;
    frame.puck.vy -= 1.55 * rel * ny;
  }
  frame.puck.vx += pad.vx * 0.38 + nx * 0.035;
  frame.puck.vy += pad.vy * 0.38 + ny * 0.035;
  const v = cap(frame.puck.vx, frame.puck.vy, MAX_PUCK);
  frame.puck.vx = v.x;
  frame.puck.vy = v.y;
}

function advance(stored: Stored, mode: Mode, now: number) {
  const roster = stored.roster;
  const frame = stored.frame ?? fresh(roster, mode, now);
  const elapsedMs = clamp(now - finite(stored.lastTick, now), 0, 220);
  if (elapsedMs <= 0) {
    stored.frame = frame;
    stored.lastTick = now;
    return;
  }

  const steps = clamp(Math.ceil(elapsedMs / 12), 1, 20);
  const dt = elapsedMs / steps / 1000;
  const targets = new Map<string, Paddle>();

  for (const player of roster) {
    const current = frame.paddles[player.userId] ?? initial(player, mode);
    const input = stored.inputs[player.userId];
    if (input && now - finite(input.at, 0) < 1600) {
      const point = clampPad(player.side, finite(input.x, current.x), finite(input.y, current.y));
      const velocity = cap(finite(input.vx), finite(input.vy), MAX_MALLET);
      targets.set(player.userId, { x: point.x, y: point.y, vx: velocity.x, vy: velocity.y });
    } else {
      targets.set(player.userId, { ...current, vx: 0, vy: 0 });
    }
  }

  for (let step = 0; step < steps; step++) {
    const remaining = Math.max(1, steps - step);
    const oldPads: Record<string, Paddle> = {};
    for (const player of roster) {
      const pad = frame.paddles[player.userId] ?? initial(player, mode);
      oldPads[player.userId] = { ...pad };
      const target = targets.get(player.userId) ?? pad;
      const nextX = pad.x + (target.x - pad.x) / remaining;
      const nextY = pad.y + (target.y - pad.y) / remaining;
      const vel = cap((nextX - pad.x) / Math.max(dt, 0.001), (nextY - pad.y) / Math.max(dt, 0.001), MAX_MALLET);
      pad.x = nextX;
      pad.y = nextY;
      pad.vx = vel.x;
      pad.vy = vel.y;
      frame.paddles[player.userId] = pad;
    }

    if (!frame.winnerSide && now >= frame.pauseUntil) {
      frame.puck.x += frame.puck.vx * dt;
      frame.puck.y += frame.puck.vy * dt;
      const friction = Math.pow(0.994, dt * 60);
      frame.puck.vx *= friction;
      frame.puck.vy *= friction;

      if (frame.puck.y - PUCK_R < TOP) { frame.puck.y = TOP + PUCK_R; frame.puck.vy = Math.abs(frame.puck.vy) * 0.96; }
      if (frame.puck.y + PUCK_R > BOTTOM) { frame.puck.y = BOTTOM - PUCK_R; frame.puck.vy = -Math.abs(frame.puck.vy) * 0.96; }

      const inGoal = frame.puck.y > GOAL_MIN && frame.puck.y < GOAL_MAX;
      if (!inGoal && frame.puck.x - PUCK_R < LEFT) { frame.puck.x = LEFT + PUCK_R; frame.puck.vx = Math.abs(frame.puck.vx) * 0.96; }
      if (!inGoal && frame.puck.x + PUCK_R > RIGHT) { frame.puck.x = RIGHT - PUCK_R; frame.puck.vx = -Math.abs(frame.puck.vx) * 0.96; }

      for (const player of roster) {
        const pad = frame.paddles[player.userId];
        collideSwept(frame, oldPads[player.userId] ?? pad, pad, player.side);
      }

      if (inGoal && frame.puck.x < -0.01) {
        frame.rightScore += 1;
        frame.puck = { x: 0.5, y: 0.5, vx: 0, vy: 0 };
        frame.pauseUntil = now + 700;
      } else if (inGoal && frame.puck.x > 1.01) {
        frame.leftScore += 1;
        frame.puck = { x: 0.5, y: 0.5, vx: 0, vy: 0 };
        frame.pauseUntil = now + 700;
      }

      if (frame.leftScore >= TARGET) frame.winnerSide = "left";
      if (frame.rightScore >= TARGET) frame.winnerSide = "right";
    }
  }

  stored.frame = frame;
  stored.lastTick = now;
}

async function ensureGame(code: string) {
  await db().query(`insert into retro_hockey_games (room_code) values ($1) on conflict (room_code) do nothing`, [code]);
}
async function getHost(code: string) {
  const r = await db().query<{ host_user_id: string }>(`select host_user_id from retro_rooms where code=$1 and expires_at>now() limit 1`, [code]);
  if (!r.rows[0]) throw new Error("Room introuvable ou expirée.");
  return r.rows[0].host_user_id;
}
async function connected(code: string) {
  const r = await db().query<{ id: string; username: string }>(
    `select u.id,u.username from retro_room_members m join retro_users u on u.id=m.user_id
     where m.room_code=$1 and m.last_seen>now()-interval '15 seconds' order by m.joined_at`,
    [code]
  );
  return r.rows;
}

export async function POST(req: NextRequest) {
  try {
    await ensureSchema();
    const user = await requireUser(req, false);
    const data = await body(req);
    const code = cleanRoomCode(data.code);
    const action = String(data.action ?? "sync");
    await requireRoomMember(code, user);
    await ensureGame(code);

    if (action === "configure") {
      if (await getHost(code) !== user.id) throw new Error("Seul l'hôte peut modifier le mode.");
      const mode: Mode = data.mode === "2v2" ? "2v2" : "1v1";
      const stored: Stored = { roster: [], frame: null, inputs: {}, lastTick: Date.now() };
      await db().query(
        `update retro_hockey_games set mode=$1,status='lobby',players=$2::jsonb,left_score=0,right_score=0,winner_side=null,updated_at=now() where room_code=$3`,
        [mode, JSON.stringify(stored), code]
      );
      const row: Row = { room_code: code, mode, status: "lobby", players: stored, left_score: 0, right_score: 0, winner_side: null };
      return NextResponse.json({ ok: true, game: publicGame(row, stored) });
    }

    if (action === "start") {
      if (await getHost(code) !== user.id) throw new Error("Seul l'hôte peut lancer le match.");
      const current = await db().query<Row>(`select room_code,mode,status,players,left_score,right_score,winner_side from retro_hockey_games where room_code=$1 limit 1`, [code]);
      const row = current.rows[0];
      if (!row) throw new Error("Partie introuvable.");
      const need = row.mode === "2v2" ? 4 : 2;
      const list = await connected(code);
      if (list.length < need) throw new Error(row.mode === "2v2" ? "Il faut 4 joueurs connectés pour le 2v2." : "Il faut 2 joueurs connectés pour le 1v1.");
      const roster: HockeyPlayer[] = list.slice(0, need).map((m, index) => ({
        userId: m.id,
        username: m.username,
        side: index % 2 === 0 ? "left" : "right",
        slot: row.mode === "2v2" ? Math.floor(index / 2) : 0,
      }));
      const now = Date.now();
      const frame = fresh(roster, row.mode, now);
      const inputs = Object.fromEntries(roster.map((p) => [p.userId, { ...initial(p, row.mode), at: now }]));
      const stored: Stored = { roster, frame, inputs, lastTick: now };
      await db().query(
        `update retro_hockey_games set status='playing',players=$1::jsonb,left_score=0,right_score=0,winner_side=null,updated_at=now() where room_code=$2`,
        [JSON.stringify(stored), code]
      );
      row.status = "playing";
      row.players = stored;
      row.left_score = 0;
      row.right_score = 0;
      row.winner_side = null;
      return NextResponse.json({ ok: true, game: publicGame(row, stored) });
    }

    if (action === "stop") {
      if (await getHost(code) !== user.id) throw new Error("Seul l'hôte peut arrêter le match.");
      const r = await db().query<Row>(`select room_code,mode,status,players,left_score,right_score,winner_side from retro_hockey_games where room_code=$1 limit 1`, [code]);
      const row = r.rows[0];
      if (!row) throw new Error("Partie introuvable.");
      const stored: Stored = { roster: [], frame: null, inputs: {}, lastTick: Date.now() };
      await db().query(`update retro_hockey_games set status='lobby',players=$1::jsonb,left_score=0,right_score=0,winner_side=null,updated_at=now() where room_code=$2`, [JSON.stringify(stored), code]);
      row.status = "lobby"; row.players = stored; row.left_score = 0; row.right_score = 0; row.winner_side = null;
      return NextResponse.json({ ok: true, game: publicGame(row, stored) });
    }

    if (action !== "sync" && action !== "poll") throw new Error("Action inconnue.");

    const client = await db().connect();
    try {
      await client.query("begin");
      const result = await client.query<Row>(
        `select room_code,mode,status,players,left_score,right_score,winner_side from retro_hockey_games where room_code=$1 for update`,
        [code]
      );
      const row = result.rows[0];
      if (!row) throw new Error("Partie introuvable.");
      const stored = decode(row.players, row.mode, row);

      if (row.status === "playing" && stored.roster.length < (row.mode === "2v2" ? 4 : 2)) {
        row.status = "lobby";
        stored.roster = [];
        stored.frame = null;
        stored.inputs = {};
      }

      const player = stored.roster.find((p) => p.userId === user.id);
      if (row.status === "playing" && player && data.x !== undefined && data.y !== undefined) {
        const point = clampPad(player.side, finite(data.x), finite(data.y));
        const velocity = cap(finite(data.vx), finite(data.vy), MAX_MALLET);
        stored.inputs[user.id] = { x: point.x, y: point.y, vx: velocity.x, vy: velocity.y, at: Date.now() };
      }

      if (row.status === "playing") {
        advance(stored, row.mode, Date.now());
        row.left_score = stored.frame?.leftScore ?? 0;
        row.right_score = stored.frame?.rightScore ?? 0;
        row.winner_side = stored.frame?.winnerSide ?? null;
        if (row.winner_side) row.status = "gameover";
        await client.query(
          `update retro_hockey_games set status=$1,players=$2::jsonb,left_score=$3,right_score=$4,winner_side=$5,updated_at=now() where room_code=$6`,
          [row.status, JSON.stringify(stored), row.left_score, row.right_score, row.winner_side, code]
        );
      } else if (!Array.isArray(row.players) && row.players && typeof row.players === "object") {
        // no write needed in lobby/gameover when state is already in the new format
      } else {
        await client.query(`update retro_hockey_games set players=$1::jsonb,updated_at=now() where room_code=$2`, [JSON.stringify(stored), code]);
      }

      await client.query("commit");
      return NextResponse.json({ ok: true, game: publicGame(row, stored) });
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erreur inconnue.";
    return NextResponse.json({ ok: false, error: message === "AUTH_REQUIRED" ? "Connexion requise." : message }, { status: message === "AUTH_REQUIRED" ? 401 : 400 });
  }
}
