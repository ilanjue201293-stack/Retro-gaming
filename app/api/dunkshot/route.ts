import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth";
import { db } from "@/lib/db";
import { cleanRoomCode, makeId, sha256 } from "@/lib/utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Player = { userId: string; username: string };
type Shot = { id: string; shooterId: string; power: number; aim: number; startedAt: number };
type LastResult = { shotId: string; shooterId: string; made: boolean; at: number };
type Row = {
  room_code: string;
  status: "lobby" | "playing" | "gameover";
  players: unknown;
  lives_total: number;
  lives: unknown;
  turn_index: number;
  streak: number;
  shot: unknown;
  last_result: unknown;
  winner_id: string | null;
};

let schemaPromise: Promise<void> | null = null;
async function ensureSchema() {
  if (!schemaPromise) {
    schemaPromise = db().query(`
      create table if not exists retro_dunkshot_games (
        room_code text primary key references retro_rooms(code) on delete cascade,
        status text not null default 'lobby',
        players jsonb not null default '[]'::jsonb,
        lives_total integer not null default 1,
        lives jsonb not null default '{}'::jsonb,
        turn_index integer not null default 0,
        streak integer not null default 0,
        shot jsonb,
        last_result jsonb,
        winner_id text,
        updated_at timestamptz not null default now()
      );
      alter table retro_dunkshot_games add column if not exists lives_total integer not null default 1;
      alter table retro_dunkshot_games add column if not exists lives jsonb not null default '{}'::jsonb;
      alter table retro_dunkshot_games add column if not exists turn_index integer not null default 0;
      alter table retro_dunkshot_games add column if not exists streak integer not null default 0;
      alter table retro_dunkshot_games add column if not exists shot jsonb;
      alter table retro_dunkshot_games add column if not exists last_result jsonb;
      alter table retro_dunkshot_games add column if not exists winner_id text;
    `).then(() => undefined).catch((error) => {
      schemaPromise = null;
      throw error;
    });
  }
  await schemaPromise;
}

async function body(req: NextRequest) {
  try { return await req.json(); } catch { return {}; }
}

async function authInRoom(req: NextRequest, code: string) {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (!token) throw new Error("AUTH_REQUIRED");
  const result = await db().query<{ id: string; username: string }>(
    `select u.id,u.username
     from retro_sessions s
     join retro_users u on u.id=s.user_id
     join retro_room_members m on m.user_id=u.id and m.room_code=$2
     join retro_rooms r on r.code=m.room_code
     where s.token_hash=$1 and s.expires_at>now() and r.expires_at>now()
     limit 1`,
    [sha256(token), code]
  );
  if (!result.rows[0]) throw new Error("Tu n'es pas dans cette room.");
  return result.rows[0];
}

async function hostId(code: string) {
  const result = await db().query<{ host_user_id: string }>(
    `select host_user_id from retro_rooms where code=$1 and expires_at>now() limit 1`,
    [code]
  );
  if (!result.rows[0]) throw new Error("Room introuvable ou expirée.");
  return result.rows[0].host_user_id;
}

async function ensureGame(code: string) {
  await ensureSchema();
  await db().query(`insert into retro_dunkshot_games (room_code) values ($1) on conflict (room_code) do nothing`, [code]);
}

function parsePlayers(value: unknown): Player[] {
  return Array.isArray(value) ? value.filter((entry): entry is Player => Boolean(entry && typeof entry === "object" && "userId" in entry && "username" in entry)) : [];
}
function parseLives(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<string, number> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) out[key] = Math.max(0, Number(raw) || 0);
  return out;
}
function parseShot(value: unknown): Shot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Partial<Shot>;
  if (!raw.id || !raw.shooterId) return null;
  return { id: String(raw.id), shooterId: String(raw.shooterId), power: Math.max(0, Math.min(1, Number(raw.power) || 0)), aim: Math.max(-1, Math.min(1, Number(raw.aim) || 0)), startedAt: Number(raw.startedAt) || Date.now() };
}
function parseResult(value: unknown): LastResult | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Partial<LastResult>;
  if (!raw.shotId || !raw.shooterId) return null;
  return { shotId: String(raw.shotId), shooterId: String(raw.shooterId), made: Boolean(raw.made), at: Number(raw.at) || Date.now() };
}

const DUNK_BALL_START_X = 0.5;
const DUNK_BALL_START_Y = 0.86;
const DUNK_GRAVITY = 2.05;
const DUNK_STEP = 1 / 180;
const DUNK_RIM_Y_OFFSET = 0.065;
const DUNK_RIM_HALF = 0.064;
const DUNK_RIM_COLLISION_RADIUS = 0.038;
const DUNK_SCORE_HALF = 0.050;
const DUNK_FLOOR_Y = 0.94;

function dunkClamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function dunkHoopPosition(streak: number, now: number) {
  if (streak < 2) return { x: 0.5, y: 0.285 };
  const horizontalAmplitude = Math.min(0.285, 0.085 + (streak - 2) * 0.018);
  const horizontalSpeed = 0.00105 + Math.min(0.00125, streak * 0.000085);
  const x = 0.5 + horizontalAmplitude * Math.sin(now * horizontalSpeed + streak * 1.43);
  if (streak < 6) return { x, y: 0.285 };
  const verticalAmplitude = Math.min(0.07, 0.018 + (streak - 6) * 0.006);
  const y = 0.285 + verticalAmplitude * Math.sin(now * (0.0008 + streak * 0.000045) + 0.9);
  return { x, y };
}

function dunkshotShotMade(shot: Shot, streak: number) {
  const power = dunkClamp(shot.power, 0, 1);
  let x = DUNK_BALL_START_X;
  let y = DUNK_BALL_START_Y;
  let vx = dunkClamp(shot.aim, -1, 1) * (0.32 + power * 0.16);
  let vy = -(1.08 + power * 0.83);
  let floorBounces = 0;
  let made = false;

  for (let elapsed = 0; elapsed <= 2.65; elapsed += DUNK_STEP) {
    const previousY = y;
    vy += DUNK_GRAVITY * DUNK_STEP;
    x += vx * DUNK_STEP;
    y += vy * DUNK_STEP;

    const hoop = dunkHoopPosition(streak, shot.startedAt + (elapsed + DUNK_STEP) * 1000);
    const rimY = hoop.y + DUNK_RIM_Y_OFFSET;

    if (!made && floorBounces === 0 && previousY < rimY && y >= rimY && vy > 0 && Math.abs(x - hoop.x) < DUNK_SCORE_HALF) {
      made = true;
      break;
    }

    if (floorBounces === 0) {
      for (const rimX of [hoop.x - DUNK_RIM_HALF, hoop.x + DUNK_RIM_HALF]) {
        const dx = x - rimX;
        const dy = y - rimY;
        const distance = Math.hypot(dx, dy);
        if (distance > 0.0001 && distance < DUNK_RIM_COLLISION_RADIUS) {
          const nx = dx / distance;
          const ny = dy / distance;
          const approach = vx * nx + vy * ny;
          if (approach < 0) {
            const restitution = 0.72;
            vx -= (1 + restitution) * approach * nx;
            vy -= (1 + restitution) * approach * ny;
            vx *= 0.97;
            vy *= 0.97;
            x = rimX + nx * DUNK_RIM_COLLISION_RADIUS;
            y = rimY + ny * DUNK_RIM_COLLISION_RADIUS;
          }
        }
      }
    }

    if (y >= DUNK_FLOOR_Y && vy > 0) {
      floorBounces += 1;
      break;
    }
    if (Math.abs(x) > 1.4) break;
  }
  return made;
}

function output(row: Row) {
  return {
    status: row.status,
    players: parsePlayers(row.players),
    livesTotal: Math.max(1, Math.min(10, Number(row.lives_total) || 1)),
    lives: parseLives(row.lives),
    turnIndex: Math.max(0, Number(row.turn_index) || 0),
    streak: Math.max(0, Number(row.streak) || 0),
    shot: parseShot(row.shot),
    lastResult: parseResult(row.last_result),
    winnerId: row.winner_id,
  };
}

async function row(code: string) {
  await ensureGame(code);
  const result = await db().query<Row>(
    `select room_code,status,players,lives_total,lives,turn_index,streak,shot,last_result,winner_id
     from retro_dunkshot_games where room_code=$1 limit 1`,
    [code]
  );
  if (!result.rows[0]) throw new Error("Dunkshot indisponible.");
  return result.rows[0];
}

async function resetOtherGames(code: string) {
  await db().query(`update retro_hockey_games set status='lobby',players='[]'::jsonb,left_score=0,right_score=0,winner_side=null,updated_at=now() where room_code=$1`, [code]).catch(() => undefined);
  await db().query(`update retro_pong_games set status='lobby',players='[]'::jsonb,left_score=0,right_score=0,winner_side=null,started_at=null,updated_at=now() where room_code=$1`, [code]).catch(() => undefined);
  await db().query(`update retro_rps_games set status='lobby',players='[]'::jsonb,round_index=0,left_score=0,right_score=0,choices='{}'::jsonb,phase='choosing',phase_started_at=null,phase_ends_at=null,last_result=null,winner_side=null,updated_at=now() where room_code=$1`, [code]).catch(() => undefined);
}

async function state(code: string) {
  const current = await row(code);
  if (current.status !== "lobby") {
    const [hockey, pong, rps] = await Promise.all([
      db().query<{ status: string }>(`select status from retro_hockey_games where room_code=$1 limit 1`, [code]).catch(() => ({ rows: [] as { status: string }[] } as any)),
      db().query<{ status: string }>(`select status from retro_pong_games where room_code=$1 limit 1`, [code]).catch(() => ({ rows: [] as { status: string }[] } as any)),
      db().query<{ status: string }>(`select status from retro_rps_games where room_code=$1 limit 1`, [code]).catch(() => ({ rows: [] as { status: string }[] } as any)),
    ]);
    if ([hockey.rows[0]?.status, pong.rows[0]?.status, rps.rows[0]?.status].some((status) => status && status !== "lobby")) {
      await db().query(`update retro_dunkshot_games set status='lobby',players='[]'::jsonb,lives='{}'::jsonb,turn_index=0,streak=0,shot=null,last_result=null,winner_id=null,updated_at=now() where room_code=$1`, [code]);
      return output(await row(code));
    }
  }
  return output(current);
}

export async function POST(req: NextRequest) {
  try {
    const data = await body(req);
    const code = cleanRoomCode(data.code);
    const action = String(data.action ?? "state");
    const user = await authInRoom(req, code);
    await ensureGame(code);

    if (action === "state") return NextResponse.json({ ok: true, game: await state(code) });

    if (action === "configure") {
      if (await hostId(code) !== user.id) throw new Error("Seul l'hôte peut régler Dunkshot.");
      const livesTotal = Math.max(1, Math.min(10, Math.round(Number(data.livesTotal) || 1)));
      await db().query(`update retro_dunkshot_games set lives_total=$1,status='lobby',players='[]'::jsonb,lives='{}'::jsonb,turn_index=0,streak=0,shot=null,last_result=null,winner_id=null,updated_at=now() where room_code=$2`, [livesTotal, code]);
      return NextResponse.json({ ok: true, game: await state(code) });
    }

    if (action === "start") {
      if (await hostId(code) !== user.id) throw new Error("Seul l'hôte peut lancer le 1v1 Dunkshot.");
      const opponentId = String(data.opponentId ?? "");
      const members = await db().query<{ id: string; username: string }>(
        `select u.id,u.username
         from retro_room_members m join retro_users u on u.id=m.user_id
         where m.room_code=$1 and m.last_seen>now()-interval '15 seconds'
         order by m.joined_at`,
        [code]
      );
      const host = members.rows.find((member) => member.id === user.id);
      const opponent = members.rows.find((member) => member.id === opponentId && member.id !== user.id) ?? members.rows.find((member) => member.id !== user.id);
      if (!host || !opponent) throw new Error("Il faut au moins 2 joueurs connectés pour le 1v1.");
      const settings = await row(code);
      const players: Player[] = [{ userId: host.id, username: host.username }, { userId: opponent.id, username: opponent.username }];
      const lives = Object.fromEntries(players.map((player) => [player.userId, Math.max(1, Math.min(10, Number(settings.lives_total) || 1))]));
      await resetOtherGames(code);
      await db().query(
        `update retro_dunkshot_games set status='playing',players=$1::jsonb,lives=$2::jsonb,turn_index=0,streak=0,shot=null,last_result=null,winner_id=null,updated_at=now() where room_code=$3`,
        [JSON.stringify(players), JSON.stringify(lives), code]
      );
      return NextResponse.json({ ok: true, game: await state(code) });
    }

    if (action === "shoot") {
      const client = await db().connect();
      try {
        await client.query("begin");
        const result = await client.query<Row>(`select room_code,status,players,lives_total,lives,turn_index,streak,shot,last_result,winner_id from retro_dunkshot_games where room_code=$1 for update`, [code]);
        const current = result.rows[0];
        if (!current || current.status !== "playing") throw new Error("La partie Dunkshot n'est pas en cours.");
        const players = parsePlayers(current.players);
        const shooter = players[Math.max(0, current.turn_index) % Math.max(1, players.length)];
        if (!shooter || shooter.userId !== user.id) throw new Error("Ce n'est pas ton tour.");
        if (parseShot(current.shot)) throw new Error("Un tir est déjà en cours.");
        const power = Math.max(0, Math.min(1, Number(data.power) || 0));
        const aim = Math.max(-1, Math.min(1, Number(data.aim) || 0));
        if (power < 0.08) throw new Error("Tir trop faible.");
        const shot: Shot = { id: makeId(), shooterId: user.id, power, aim, startedAt: Date.now() + 280 };
        await client.query(`update retro_dunkshot_games set shot=$1::jsonb,last_result=null,updated_at=now() where room_code=$2`, [JSON.stringify(shot), code]);
        await client.query("commit");
        return NextResponse.json({ ok: true, game: await state(code) });
      } catch (error) {
        await client.query("rollback");
        throw error;
      } finally { client.release(); }
    }

    if (action === "resolve") {
      const client = await db().connect();
      try {
        await client.query("begin");
        const result = await client.query<Row>(`select room_code,status,players,lives_total,lives,turn_index,streak,shot,last_result,winner_id from retro_dunkshot_games where room_code=$1 for update`, [code]);
        const current = result.rows[0];
        if (!current || current.status !== "playing") { await client.query("rollback"); return NextResponse.json({ ok: true, game: await state(code) }); }
        const shot = parseShot(current.shot);
        const shotId = String(data.shotId ?? "");
        if (!shot || shot.id !== shotId) { await client.query("rollback"); return NextResponse.json({ ok: true, game: await state(code) }); }
        if (shot.shooterId !== user.id) throw new Error("Seul le tireur peut valider son tir.");
        const players = parsePlayers(current.players);
        const lives = parseLives(current.lives);
        const made = dunkshotShotMade(shot, Math.max(0, Number(current.streak) || 0));
        let streak = Math.max(0, Number(current.streak) || 0);
        let winnerId: string | null = null;
        if (made) streak += 1;
        else {
          lives[user.id] = Math.max(0, (lives[user.id] ?? current.lives_total) - 1);
          streak = 0;
          if (lives[user.id] <= 0) winnerId = players.find((player) => player.userId !== user.id)?.userId ?? null;
        }
        const lastResult: LastResult = { shotId: shot.id, shooterId: user.id, made, at: Date.now() };
        const nextTurn = players.length ? (Math.max(0, Number(current.turn_index) || 0) + 1) % players.length : 0;
        await client.query(
          `update retro_dunkshot_games set lives=$1::jsonb,turn_index=$2,streak=$3,shot=null,last_result=$4::jsonb,winner_id=$5,status=$6,updated_at=now() where room_code=$7`,
          [JSON.stringify(lives), nextTurn, streak, JSON.stringify(lastResult), winnerId, winnerId ? "gameover" : "playing", code]
        );
        await client.query("commit");
        return NextResponse.json({ ok: true, game: await state(code) });
      } catch (error) {
        try { await client.query("rollback"); } catch {}
        throw error;
      } finally { client.release(); }
    }

    if (action === "stop") {
      if (await hostId(code) !== user.id) throw new Error("Seul l'hôte peut arrêter Dunkshot.");
      await db().query(`update retro_dunkshot_games set status='lobby',players='[]'::jsonb,lives='{}'::jsonb,turn_index=0,streak=0,shot=null,last_result=null,winner_id=null,updated_at=now() where room_code=$1`, [code]);
      return NextResponse.json({ ok: true, game: await state(code) });
    }

    throw new Error("Action Dunkshot inconnue.");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erreur inconnue.";
    return NextResponse.json({ ok: false, error: message === "AUTH_REQUIRED" ? "Connexion requise." : message }, { status: message === "AUTH_REQUIRED" ? 401 : 400 });
  }
}
