import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth";
import { db } from "@/lib/db";
import { cleanRoomCode, makeId, sha256 } from "@/lib/utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type BotDifficulty = "easy" | "normal" | "hard";
type Player = { userId: string; username: string; isBot?: boolean; difficulty?: BotDifficulty };
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
  time_limit_sec: number;
  started_at: number | null;
  ends_at: number | null;
};

const BOT_ID = "__dunkshot_bot__";

async function body(req: NextRequest) {
  try { return await req.json(); } catch { return {}; }
}

function difficulty(value: unknown): BotDifficulty {
  return value === "easy" || value === "hard" ? value : "normal";
}

async function ensureDunkshotSchema() {
  await db().query(`
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
      time_limit_sec integer not null default 0,
      started_at bigint,
      ends_at bigint,
      updated_at timestamptz not null default now()
    );
  `);
}

async function authInRoom(req: NextRequest, code: string) {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (!token) throw new Error("AUTH_REQUIRED");
  const result = await db().query<{ id: string; username: string; host_user_id: string }>(
    `select u.id,u.username,r.host_user_id
     from retro_sessions s
     join retro_users u on u.id=s.user_id
     join retro_room_members m on m.user_id=u.id and m.room_code=$2
     join retro_rooms r on r.code=m.room_code
     where s.token_hash=$1 and s.expires_at>now() and r.expires_at>now()
     limit 1`,
    [sha256(token), code]
  );
  const row = result.rows[0];
  if (!row) throw new Error("Tu n'es pas dans cette room.");
  return row;
}

function parsePlayers(value: unknown): Player[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is Player => Boolean(entry && typeof entry === "object" && "userId" in entry && "username" in entry))
    : [];
}

function parseLives(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result: Record<string, number> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) result[key] = Math.max(0, Number(raw) || 0);
  return result;
}

function parseShot(value: unknown): Shot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Partial<Shot>;
  if (!raw.id || !raw.shooterId) return null;
  return {
    id: String(raw.id),
    shooterId: String(raw.shooterId),
    power: Math.max(0, Math.min(1, Number(raw.power) || 0)),
    aim: Math.max(-1, Math.min(1, Number(raw.aim) || 0)),
    startedAt: Number(raw.startedAt) || Date.now(),
  };
}

const BALL_START_X = 0.5;
const BALL_START_Y = 0.86;
const GRAVITY = 2.05;
const STEP = 1 / 180;
const RIM_Y_OFFSET = 0.065;
const RIM_HALF = 0.064;
const RIM_COLLISION_RADIUS = 0.038;
const SCORE_HALF = 0.050;
const FLOOR_Y = 0.94;

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function hoopPosition(streak: number, now: number) {
  if (streak < 2) return { x: 0.5, y: 0.285 };
  const horizontalAmplitude = Math.min(0.285, 0.085 + (streak - 2) * 0.018);
  const horizontalSpeed = 0.00105 + Math.min(0.00125, streak * 0.000085);
  const x = 0.5 + horizontalAmplitude * Math.sin(now * horizontalSpeed + streak * 1.43);
  if (streak < 6) return { x, y: 0.285 };
  const verticalAmplitude = Math.min(0.07, 0.018 + (streak - 6) * 0.006);
  const y = 0.285 + verticalAmplitude * Math.sin(now * (0.0008 + streak * 0.000045) + 0.9);
  return { x, y };
}

function shotMade(shot: Shot, streak: number) {
  const power = clamp(shot.power, 0, 1);
  let x = BALL_START_X;
  let y = BALL_START_Y;
  let vx = clamp(shot.aim, -1, 1) * (0.32 + power * 0.16);
  let vy = -(1.08 + power * 0.83);
  let floorBounces = 0;

  for (let elapsed = 0; elapsed <= 2.65; elapsed += STEP) {
    const previousY = y;
    vy += GRAVITY * STEP;
    x += vx * STEP;
    y += vy * STEP;
    const hoop = hoopPosition(streak, shot.startedAt + (elapsed + STEP) * 1000);
    const rimY = hoop.y + RIM_Y_OFFSET;

    if (floorBounces === 0 && previousY < rimY && y >= rimY && vy > 0 && Math.abs(x - hoop.x) < SCORE_HALF) return true;

    if (floorBounces === 0 && vy > 0) {
      for (const rimX of [hoop.x - RIM_HALF, hoop.x + RIM_HALF]) {
        const dx = x - rimX;
        const dy = y - rimY;
        const distance = Math.hypot(dx, dy);
        if (dy <= 0.002 && distance > 0.0001 && distance < RIM_COLLISION_RADIUS) {
          const nx = dx / distance;
          const ny = dy / distance;
          const approach = vx * nx + vy * ny;
          if (approach < 0) {
            const restitution = 0.72;
            vx -= (1 + restitution) * approach * nx;
            vy -= (1 + restitution) * approach * ny;
            vx *= 0.97;
            vy *= 0.97;
            x = rimX + nx * RIM_COLLISION_RADIUS;
            y = rimY + ny * RIM_COLLISION_RADIUS;
          }
        }
      }
    }
    if (y >= FLOOR_Y && vy > 0) { floorBounces += 1; break; }
    if (Math.abs(x) > 1.4) break;
  }
  return false;
}

function makeBotShot(level: BotDifficulty, streak: number): Shot {
  const startedAt = Date.now() + (level === "hard" ? 380 : level === "easy" ? 720 : 520);
  const makeChance = level === "easy" ? 0.35 : level === "hard" ? 0.82 : 0.60;
  const wantsMake = Math.random() < makeChance;
  let fallback: Shot = { id: makeId(), shooterId: BOT_ID, power: 0.72, aim: 0, startedAt };

  for (let attempt = 0; attempt < 90; attempt++) {
    const power = level === "hard" ? 0.58 + Math.random() * 0.34 : 0.48 + Math.random() * 0.47;
    const aimSpread = level === "hard" ? 0.28 : level === "normal" ? 0.46 : 0.72;
    const aim = (Math.random() * 2 - 1) * aimSpread;
    const candidate: Shot = { id: makeId(), shooterId: BOT_ID, power, aim, startedAt };
    fallback = candidate;
    if (shotMade(candidate, streak) === wantsMake) return candidate;
  }
  return fallback;
}

async function resetOtherGames(code: string) {
  await db().query(`update retro_hockey_games set status='lobby',players='[]'::jsonb,left_score=0,right_score=0,winner_side=null,updated_at=now() where room_code=$1`, [code]).catch(() => undefined);
  await db().query(`update retro_pong_games set status='lobby',players='[]'::jsonb,left_score=0,right_score=0,winner_side=null,started_at=null,updated_at=now() where room_code=$1`, [code]).catch(() => undefined);
  await db().query(`update retro_rps_games set status='lobby',players='[]'::jsonb,round_index=0,left_score=0,right_score=0,choices='{}'::jsonb,phase='choosing',phase_started_at=null,phase_ends_at=null,last_result=null,winner_side=null,updated_at=now() where room_code=$1`, [code]).catch(() => undefined);
  await db().query(`update retro_tictactoe_games set status='lobby',player_x_id=null,player_o_id=null,bot_o=false,board='["","","","","","","","",""]'::jsonb,turn='X',winner=null,updated_at=now() where room_code=$1`, [code]).catch(() => undefined);
}

export async function POST(req: NextRequest) {
  try {
    const data = await body(req);
    const code = cleanRoomCode(data.code);
    if (code.length !== 5) throw new Error("Code invalide.");
    await ensureDunkshotSchema();
    const user = await authInRoom(req, code);
    if (user.host_user_id !== user.id) throw new Error("Seul l'hôte peut synchroniser le bot.");
    const action = String(data.action ?? "tick");

    if (action === "startBot") {
      await db().query(`insert into retro_dunkshot_games (room_code) values ($1) on conflict (room_code) do nothing`, [code]);
      const settings = await db().query<Row>(`select * from retro_dunkshot_games where room_code=$1 limit 1`, [code]);
      const row = settings.rows[0];
      if (!row) throw new Error("Dunkshot indisponible.");
      const level = difficulty(data.botDifficulty);
      const players: Player[] = [
        { userId: user.id, username: user.username },
        { userId: BOT_ID, username: "BOT", isBot: true, difficulty: level },
      ];
      const livesTotal = Math.max(1, Math.min(10, Number(row.lives_total) || 1));
      const lives = { [user.id]: livesTotal, [BOT_ID]: livesTotal };
      const timeLimitSec = Math.max(0, Math.min(600, Number(row.time_limit_sec) || 0));
      const startedAt = Date.now();
      const endsAt = timeLimitSec > 0 ? startedAt + timeLimitSec * 1000 : null;
      await resetOtherGames(code);
      await db().query(
        `update retro_dunkshot_games
         set status='playing',players=$1::jsonb,lives=$2::jsonb,turn_index=0,streak=0,shot=null,last_result=null,winner_id=null,started_at=$3,ends_at=$4,updated_at=now()
         where room_code=$5`,
        [JSON.stringify(players), JSON.stringify(lives), startedAt, endsAt, code]
      );
      return NextResponse.json({ ok: true });
    }

    if (action === "tick") {
      const client = await db().connect();
      try {
        await client.query("begin");
        const result = await client.query<Row>(`select * from retro_dunkshot_games where room_code=$1 for update`, [code]);
        const current = result.rows[0];
        if (!current || current.status !== "playing") {
          await client.query("rollback");
          return NextResponse.json({ ok: true, changed: false });
        }
        const players = parsePlayers(current.players);
        const bot = players.find((player) => player.userId === BOT_ID && player.isBot);
        const currentPlayer = players[Math.max(0, Number(current.turn_index) || 0) % Math.max(1, players.length)];
        if (!bot || currentPlayer?.userId !== BOT_ID) {
          await client.query("rollback");
          return NextResponse.json({ ok: true, changed: false });
        }

        const activeShot = parseShot(current.shot);
        if (!activeShot) {
          const shot = makeBotShot(difficulty(bot.difficulty), Math.max(0, Number(current.streak) || 0));
          await client.query(`update retro_dunkshot_games set shot=$1::jsonb,last_result=null,updated_at=now() where room_code=$2`, [JSON.stringify(shot), code]);
          await client.query("commit");
          return NextResponse.json({ ok: true, changed: true });
        }

        if (activeShot.shooterId !== BOT_ID || Date.now() < activeShot.startedAt + 2750) {
          await client.query("rollback");
          return NextResponse.json({ ok: true, changed: false });
        }

        const lives = parseLives(current.lives);
        const made = shotMade(activeShot, Math.max(0, Number(current.streak) || 0));
        let streak = Math.max(0, Number(current.streak) || 0);
        let winnerId: string | null = null;
        if (made) streak += 1;
        else {
          lives[BOT_ID] = Math.max(0, (lives[BOT_ID] ?? current.lives_total) - 1);
          streak = 0;
          if (lives[BOT_ID] <= 0) winnerId = players.find((player) => player.userId !== BOT_ID)?.userId ?? null;
        }
        const lastResult: LastResult = { shotId: activeShot.id, shooterId: BOT_ID, made, at: Date.now() };
        const nextTurn = players.length ? (Math.max(0, Number(current.turn_index) || 0) + 1) % players.length : 0;
        await client.query(
          `update retro_dunkshot_games
           set lives=$1::jsonb,turn_index=$2,streak=$3,shot=null,last_result=$4::jsonb,winner_id=$5,status=$6,updated_at=now()
           where room_code=$7`,
          [JSON.stringify(lives), nextTurn, streak, JSON.stringify(lastResult), winnerId, winnerId ? "gameover" : "playing", code]
        );
        await client.query("commit");
        return NextResponse.json({ ok: true, changed: true });
      } catch (error) {
        try { await client.query("rollback"); } catch {}
        throw error;
      } finally {
        client.release();
      }
    }

    throw new Error("Action bot Dunkshot inconnue.");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erreur inconnue.";
    return NextResponse.json({ ok: false, error: message === "AUTH_REQUIRED" ? "Connexion requise." : message }, { status: message === "AUTH_REQUIRED" ? 401 : 400 });
  }
}
