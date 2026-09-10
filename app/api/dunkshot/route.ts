import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { requireRoomMember } from "@/lib/room";
import { cleanRoomCode, makeId } from "@/lib/utils";
import { DUNK_DURATION, type DunkShot, dunkshotShotMade } from "@/lib/dunkshot-physics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type BotDifficulty = "easy" | "normal" | "hard";
type Player = { userId: string; username: string; isBot?: boolean; difficulty?: BotDifficulty };
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

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const difficulty = (value: unknown): BotDifficulty => value === "easy" || value === "hard" ? value : "normal";

function parsePlayers(value: unknown): Player[] {
  return Array.isArray(value) ? value.filter((entry): entry is Player => Boolean(entry && typeof entry === "object" && "userId" in entry && "username" in entry)) : [];
}
function parseLives(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, raw]) => [key, Math.max(0, Number(raw) || 0)]));
}
function parseShot(value: unknown): DunkShot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Partial<DunkShot>;
  if (!raw.id || !raw.shooterId) return null;
  return { id: String(raw.id), shooterId: String(raw.shooterId), power: clamp(Number(raw.power) || 0, 0, 1), aim: clamp(Number(raw.aim) || 0, -1, 1), startedAt: Number(raw.startedAt) || Date.now() };
}
function parseResult(value: unknown): LastResult | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Partial<LastResult>;
  if (!raw.shotId || !raw.shooterId) return null;
  return { shotId: String(raw.shotId), shooterId: String(raw.shooterId), made: Boolean(raw.made), at: Number(raw.at) || Date.now() };
}

let schemaPromise: Promise<void> | null = null;
async function ensureSchema() {
  if (!schemaPromise) {
    schemaPromise = db().query(`
      create table if not exists retro_dunkshot_games (
        room_code text primary key references retro_rooms(code) on delete cascade,
        status text not null default 'lobby', players jsonb not null default '[]'::jsonb,
        lives_total integer not null default 3, lives jsonb not null default '{}'::jsonb,
        turn_index integer not null default 0, streak integer not null default 0,
        shot jsonb, last_result jsonb, winner_id text, time_limit_sec integer not null default 0,
        started_at bigint, ends_at bigint, updated_at timestamptz not null default now()
      );
      alter table retro_dunkshot_games add column if not exists lives_total integer not null default 3;
      alter table retro_dunkshot_games add column if not exists lives jsonb not null default '{}'::jsonb;
      alter table retro_dunkshot_games add column if not exists turn_index integer not null default 0;
      alter table retro_dunkshot_games add column if not exists streak integer not null default 0;
      alter table retro_dunkshot_games add column if not exists shot jsonb;
      alter table retro_dunkshot_games add column if not exists last_result jsonb;
      alter table retro_dunkshot_games add column if not exists winner_id text;
      alter table retro_dunkshot_games add column if not exists time_limit_sec integer not null default 0;
      alter table retro_dunkshot_games add column if not exists started_at bigint;
      alter table retro_dunkshot_games add column if not exists ends_at bigint;
    `).then(() => undefined).catch((error) => { schemaPromise = null; throw error; });
  }
  await schemaPromise;
}

async function ensureGame(code: string) {
  await ensureSchema();
  await db().query(`insert into retro_dunkshot_games (room_code) values ($1) on conflict (room_code) do nothing`, [code]);
}

async function getRow(code: string) {
  await ensureGame(code);
  const result = await db().query<Row>(`select room_code,status,players,lives_total,lives,turn_index,streak,shot,last_result,winner_id,time_limit_sec,started_at,ends_at from retro_dunkshot_games where room_code=$1 limit 1`, [code]);
  if (!result.rows[0]) throw new Error("Dunkshot indisponible.");
  return result.rows[0];
}

function output(row: Row) {
  return {
    status: row.status,
    players: parsePlayers(row.players),
    livesTotal: clamp(Math.round(Number(row.lives_total) || 3), 1, 10),
    lives: parseLives(row.lives),
    turnIndex: Math.max(0, Math.round(Number(row.turn_index) || 0)),
    streak: Math.max(0, Math.round(Number(row.streak) || 0)),
    shot: parseShot(row.shot),
    lastResult: parseResult(row.last_result),
    winnerId: row.winner_id,
    timeLimitSec: clamp(Math.round(Number(row.time_limit_sec) || 0), 0, 600),
    startedAt: row.started_at ? Number(row.started_at) : null,
    endsAt: row.ends_at ? Number(row.ends_at) : null,
  };
}

async function resolveShot(code: string, expectedShotId?: string) {
  const client = await db().connect();
  try {
    await client.query("begin");
    const result = await client.query<Row>(`select room_code,status,players,lives_total,lives,turn_index,streak,shot,last_result,winner_id,time_limit_sec,started_at,ends_at from retro_dunkshot_games where room_code=$1 for update`, [code]);
    const current = result.rows[0];
    if (!current || current.status !== "playing") { await client.query("rollback"); return; }
    const shot = parseShot(current.shot);
    if (!shot || (expectedShotId && shot.id !== expectedShotId)) { await client.query("rollback"); return; }
    if (Date.now() < shot.startedAt + DUNK_DURATION * 1000 + 40) { await client.query("rollback"); return; }

    const players = parsePlayers(current.players);
    const lives = parseLives(current.lives);
    const made = dunkshotShotMade(shot, Math.max(0, Number(current.streak) || 0));
    let streak = Math.max(0, Number(current.streak) || 0);
    let winnerId: string | null = null;
    if (made) streak += 1;
    else {
      lives[shot.shooterId] = Math.max(0, (lives[shot.shooterId] ?? current.lives_total) - 1);
      streak = 0;
      if (lives[shot.shooterId] <= 0) winnerId = players.find((player) => player.userId !== shot.shooterId)?.userId ?? null;
    }
    const lastResult: LastResult = { shotId: shot.id, shooterId: shot.shooterId, made, at: Date.now() };
    const nextTurn = players.length ? (Math.max(0, Number(current.turn_index) || 0) + 1) % players.length : 0;
    await client.query(`update retro_dunkshot_games set lives=$1::jsonb,turn_index=$2,streak=$3,shot=null,last_result=$4::jsonb,winner_id=$5,status=$6,updated_at=now() where room_code=$7`, [JSON.stringify(lives), nextTurn, streak, JSON.stringify(lastResult), winnerId, winnerId ? "gameover" : "playing", code]);
    await client.query("commit");
  } catch (error) { try { await client.query("rollback"); } catch {} throw error; }
  finally { client.release(); }
}

async function state(code: string) {
  let row = await getRow(code);
  const shot = parseShot(row.shot);
  if (shot && Date.now() >= shot.startedAt + DUNK_DURATION * 1000 + 40) {
    await resolveShot(code, shot.id);
    row = await getRow(code);
  }
  if (row.status === "playing" && row.ends_at && Date.now() >= Number(row.ends_at) && !parseShot(row.shot)) {
    const players = parsePlayers(row.players), lives = parseLives(row.lives);
    let winnerId: string | null = null;
    if (players.length >= 2) {
      const a = lives[players[0].userId] ?? row.lives_total, b = lives[players[1].userId] ?? row.lives_total;
      if (a > b) winnerId = players[0].userId; else if (b > a) winnerId = players[1].userId;
    }
    await db().query(`update retro_dunkshot_games set status='gameover',winner_id=$1,updated_at=now() where room_code=$2`, [winnerId, code]);
    row = await getRow(code);
  }
  return output(row);
}

function makeBotShot(level: BotDifficulty, streak: number): DunkShot {
  const wantedChance = level === "easy" ? 0.48 : level === "hard" ? 0.95 : 0.78;
  const wantsMake = Math.random() < wantedChance;
  const startedAt = Date.now() + (level === "hard" ? 250 : level === "easy" ? 560 : 390);
  let fallback: DunkShot = { id: makeId(), shooterId: BOT_ID, power: 0.7, aim: 0, startedAt };
  for (let attempt = 0; attempt < 180; attempt++) {
    const power = level === "hard" ? 0.54 + Math.random() * 0.39 : 0.45 + Math.random() * 0.52;
    const spread = level === "hard" ? 0.34 : level === "normal" ? 0.55 : 0.82;
    const aim = (Math.random() * 2 - 1) * spread;
    const shot = { id: makeId(), shooterId: BOT_ID, power, aim, startedAt };
    fallback = shot;
    if (dunkshotShotMade(shot, streak) === wantsMake) return shot;
  }
  return fallback;
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

    if (action === "state") return NextResponse.json({ ok: true, game: await state(code) });

    if (action === "configure") {
      if (membership.host_user_id !== user.id) throw new Error("Seul l'hôte peut régler Dunkshot.");
      const livesTotal = clamp(Math.round(Number(data.livesTotal) || 3), 1, 10);
      const timeLimitSec = clamp(Math.round(Number(data.timeLimitSec) || 0), 0, 600);
      await db().query(`update retro_dunkshot_games set lives_total=$1,time_limit_sec=$2,status='lobby',players='[]'::jsonb,lives='{}'::jsonb,turn_index=0,streak=0,shot=null,last_result=null,winner_id=null,started_at=null,ends_at=null,updated_at=now() where room_code=$3`, [livesTotal, timeLimitSec, code]);
      return NextResponse.json({ ok: true, game: await state(code) });
    }

    if (action === "start" || action === "startBot") {
      if (membership.host_user_id !== user.id) throw new Error("Seul l'hôte peut lancer Dunkshot.");
      const settings = await getRow(code);
      const members = await db().query<{ id: string; username: string }>(`select u.id,u.username from retro_room_members m join retro_users u on u.id=m.user_id where m.room_code=$1 and m.last_seen>now()-interval '15 seconds' order by m.joined_at`, [code]);
      const host = members.rows.find((member) => member.id === user.id);
      if (!host) throw new Error("Hôte introuvable.");
      let opponent: Player;
      if (action === "startBot") opponent = { userId: BOT_ID, username: "BOT", isBot: true, difficulty: difficulty(data.botDifficulty) };
      else {
        const opponentId = String(data.opponentId ?? "");
        const found = members.rows.find((member) => member.id === opponentId && member.id !== user.id) ?? members.rows.find((member) => member.id !== user.id);
        if (!found) throw new Error("Il faut un deuxième joueur, ou utilise le BOT.");
        opponent = { userId: found.id, username: found.username };
      }
      const players: Player[] = [{ userId: host.id, username: host.username }, opponent];
      const livesTotal = clamp(Number(settings.lives_total) || 3, 1, 10);
      const lives = { [players[0].userId]: livesTotal, [players[1].userId]: livesTotal };
      const startedAt = Date.now();
      const timeLimitSec = clamp(Number(settings.time_limit_sec) || 0, 0, 600);
      const endsAt = timeLimitSec > 0 ? startedAt + timeLimitSec * 1000 : null;
      await db().query(`update retro_dunkshot_games set status='playing',players=$1::jsonb,lives=$2::jsonb,turn_index=0,streak=0,shot=null,last_result=null,winner_id=null,started_at=$3,ends_at=$4,updated_at=now() where room_code=$5`, [JSON.stringify(players), JSON.stringify(lives), startedAt, endsAt, code]);
      return NextResponse.json({ ok: true, game: await state(code) });
    }

    if (action === "shoot") {
      const client = await db().connect();
      try {
        await client.query("begin");
        const result = await client.query<Row>(`select room_code,status,players,lives_total,lives,turn_index,streak,shot,last_result,winner_id,time_limit_sec,started_at,ends_at from retro_dunkshot_games where room_code=$1 for update`, [code]);
        const current = result.rows[0];
        if (!current || current.status !== "playing") throw new Error("La partie Dunkshot n'est pas en cours.");
        const players = parsePlayers(current.players);
        const currentPlayer = players[Math.max(0, Number(current.turn_index) || 0) % Math.max(1, players.length)];
        if (!currentPlayer || currentPlayer.userId !== user.id || currentPlayer.isBot) throw new Error("Ce n'est pas ton tour.");
        if (parseShot(current.shot)) throw new Error("Un tir est déjà en cours.");
        const power = clamp(Number(data.power) || 0, 0, 1), aim = clamp(Number(data.aim) || 0, -1, 1);
        if (power < 0.08) throw new Error("Tir trop faible.");
        const now = Date.now();
        const requestedStart = Number(data.startedAt);
        const shot: DunkShot = {
          id: String(data.shotId || makeId()).slice(0, 120), shooterId: user.id, power, aim,
          startedAt: Number.isFinite(requestedStart) ? clamp(requestedStart, now - 30, now + 100) : now + 45,
        };
        await client.query(`update retro_dunkshot_games set shot=$1::jsonb,last_result=null,updated_at=now() where room_code=$2`, [JSON.stringify(shot), code]);
        await client.query("commit");
      } catch (error) { try { await client.query("rollback"); } catch {} throw error; }
      finally { client.release(); }
      return NextResponse.json({ ok: true, game: await state(code) });
    }

    if (action === "resolve") {
      await resolveShot(code, String(data.shotId ?? ""));
      return NextResponse.json({ ok: true, game: await state(code) });
    }

    if (action === "botTick") {
      if (membership.host_user_id !== user.id) throw new Error("Seul l'hôte synchronise le bot.");
      let current = await getRow(code);
      if (current.status !== "playing") return NextResponse.json({ ok: true, game: output(current), changed: false });
      const players = parsePlayers(current.players), bot = players.find((player) => player.userId === BOT_ID && player.isBot);
      const currentPlayer = players[Math.max(0, Number(current.turn_index) || 0) % Math.max(1, players.length)];
      if (!bot || currentPlayer?.userId !== BOT_ID) return NextResponse.json({ ok: true, game: output(current), changed: false });
      const active = parseShot(current.shot);
      if (active) {
        if (Date.now() >= active.startedAt + DUNK_DURATION * 1000 + 40) await resolveShot(code, active.id);
      } else {
        const shot = makeBotShot(difficulty(bot.difficulty), Math.max(0, Number(current.streak) || 0));
        await db().query(`update retro_dunkshot_games set shot=$1::jsonb,last_result=null,updated_at=now() where room_code=$2 and shot is null`, [JSON.stringify(shot), code]);
      }
      current = await getRow(code);
      return NextResponse.json({ ok: true, game: output(current), changed: true });
    }

    if (action === "stop") {
      if (membership.host_user_id !== user.id) throw new Error("Seul l'hôte peut arrêter Dunkshot.");
      await db().query(`update retro_dunkshot_games set status='lobby',players='[]'::jsonb,lives='{}'::jsonb,turn_index=0,streak=0,shot=null,last_result=null,winner_id=null,started_at=null,ends_at=null,updated_at=now() where room_code=$1`, [code]);
      return NextResponse.json({ ok: true, game: await state(code) });
    }

    throw new Error("Action Dunkshot inconnue.");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erreur Dunkshot.";
    return NextResponse.json({ ok: false, error: message }, { status: message === "AUTH_REQUIRED" ? 401 : 400 });
  }
}
