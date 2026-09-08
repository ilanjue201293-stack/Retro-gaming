import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth";
import { db } from "@/lib/db";
import { cleanRoomCode, sha256 } from "@/lib/utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Side = "left" | "right";
type Player = { userId: string; username: string; side: Side };
type PongRow = {
  room_code: string;
  status: "lobby" | "playing" | "gameover";
  players: unknown;
  left_score: number;
  right_score: number;
  winner_side: Side | null;
};

let schemaPromise: Promise<void> | null = null;
async function ensurePongSchema() {
  if (!schemaPromise) {
    schemaPromise = db().query(`
      create table if not exists retro_pong_games (
        room_code text primary key references retro_rooms(code) on delete cascade,
        status text not null default 'lobby',
        players jsonb not null default '[]'::jsonb,
        left_score integer not null default 0,
        right_score integer not null default 0,
        winner_side text,
        updated_at timestamptz not null default now()
      );
      create table if not exists retro_pong_signals (
        id bigserial primary key,
        room_code text not null references retro_rooms(code) on delete cascade,
        sender_id text not null references retro_users(id) on delete cascade,
        target_id text not null references retro_users(id) on delete cascade,
        kind text not null,
        payload jsonb not null,
        created_at timestamptz not null default now()
      );
      create index if not exists retro_pong_signal_target_idx
        on retro_pong_signals(room_code,target_id,id);
    `).then(() => undefined).catch((error) => {
      schemaPromise = null;
      throw error;
    });
  }
  await schemaPromise;
}

async function readBody(req: NextRequest) {
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

async function ensureGame(code: string) {
  await ensurePongSchema();
  await db().query(`insert into retro_pong_games (room_code) values ($1) on conflict (room_code) do nothing`, [code]);
}

async function hostId(code: string) {
  const result = await db().query<{ host_user_id: string }>(
    `select host_user_id from retro_rooms where code=$1 and expires_at>now() limit 1`,
    [code]
  );
  if (!result.rows[0]) throw new Error("Room introuvable ou expirée.");
  return result.rows[0].host_user_id;
}

function gameOutput(row: PongRow) {
  return {
    status: row.status,
    players: Array.isArray(row.players) ? row.players as Player[] : [],
    leftScore: Number(row.left_score || 0),
    rightScore: Number(row.right_score || 0),
    winnerSide: row.winner_side,
    targetScore: 7,
  };
}

async function state(code: string) {
  await ensureGame(code);
  const hockey = await db().query<{ status: string }>(`select status from retro_hockey_games where room_code=$1 limit 1`, [code]);
  if (hockey.rows[0] && hockey.rows[0].status !== "lobby") {
    await db().query(`update retro_pong_games set status='lobby',players='[]'::jsonb,left_score=0,right_score=0,winner_side=null,updated_at=now() where room_code=$1 and status<>'lobby'`, [code]);
  }
  const result = await db().query<PongRow>(
    `select room_code,status,players,left_score,right_score,winner_side from retro_pong_games where room_code=$1 limit 1`,
    [code]
  );
  if (!result.rows[0]) throw new Error("Pong indisponible.");
  return gameOutput(result.rows[0]);
}

export async function POST(req: NextRequest) {
  try {
    const data = await readBody(req);
    const action = String(data.action ?? "state");
    const code = cleanRoomCode(data.code);
    const user = await authInRoom(req, code);
    await ensurePongSchema();

    if (action === "state") {
      return NextResponse.json({ ok: true, game: await state(code) });
    }

    if (action === "start") {
      if (await hostId(code) !== user.id) throw new Error("Seul l'hôte peut lancer Pong.");
      await ensureGame(code);
      const members = await db().query<{ id: string; username: string }>(
        `select u.id,u.username
         from retro_room_members m join retro_users u on u.id=m.user_id
         where m.room_code=$1 and m.last_seen>now()-interval '15 seconds'
         order by m.joined_at`,
        [code]
      );
      if (members.rows.length !== 2) throw new Error("Pong se joue avec exactement 2 joueurs connectés.");
      const players: Player[] = [
        { userId: members.rows[0].id, username: members.rows[0].username, side: "left" },
        { userId: members.rows[1].id, username: members.rows[1].username, side: "right" },
      ];
      await db().query(`update retro_hockey_games set status='lobby',players='[]'::jsonb,left_score=0,right_score=0,winner_side=null,updated_at=now() where room_code=$1`, [code]);
      await db().query(
        `update retro_pong_games set status='playing',players=$1::jsonb,left_score=0,right_score=0,winner_side=null,updated_at=now() where room_code=$2`,
        [JSON.stringify(players), code]
      );
      await db().query(`delete from retro_pong_signals where room_code=$1`, [code]);
      return NextResponse.json({ ok: true, game: await state(code) });
    }

    if (action === "stop") {
      if (await hostId(code) !== user.id) throw new Error("Seul l'hôte peut arrêter Pong.");
      await ensureGame(code);
      await db().query(`update retro_pong_games set status='lobby',players='[]'::jsonb,left_score=0,right_score=0,winner_side=null,updated_at=now() where room_code=$1`, [code]);
      await db().query(`delete from retro_pong_signals where room_code=$1`, [code]);
      return NextResponse.json({ ok: true, game: await state(code) });
    }

    if (action === "checkpoint") {
      if (await hostId(code) !== user.id) throw new Error("Seul l'hôte peut synchroniser Pong.");
      const leftScore = Math.max(0, Math.min(99, Number(data.leftScore) || 0));
      const rightScore = Math.max(0, Math.min(99, Number(data.rightScore) || 0));
      const winnerSide: Side | null = leftScore >= 7 ? "left" : rightScore >= 7 ? "right" : null;
      await db().query(
        `update retro_pong_games set left_score=$1,right_score=$2,winner_side=$3,status=case when $3::text is null then 'playing' else 'gameover' end,updated_at=now() where room_code=$4`,
        [leftScore, rightScore, winnerSide, code]
      );
      return NextResponse.json({ ok: true });
    }

    if (action === "signal") {
      const targetId = String(data.targetId ?? "");
      const kind = String(data.kind ?? "");
      if (!["offer", "answer", "ice", "input", "state"].includes(kind)) throw new Error("Signal Pong invalide.");
      if (!targetId || targetId === user.id) throw new Error("Destinataire invalide.");
      const member = await db().query(`select 1 from retro_room_members where room_code=$1 and user_id=$2 limit 1`, [code, targetId]);
      if (!member.rowCount) throw new Error("Destinataire introuvable.");
      const raw = JSON.stringify(data.payload ?? {});
      if (raw.length > 50000) throw new Error("Signal Pong trop volumineux.");
      await db().query(
        `insert into retro_pong_signals (room_code,sender_id,target_id,kind,payload) values ($1,$2,$3,$4,$5::jsonb)`,
        [code, user.id, targetId, kind, raw]
      );
      return NextResponse.json({ ok: true });
    }

    if (action === "poll") {
      const after = Math.max(0, Number(data.after ?? 0) || 0);
      const signals = await db().query<{ id: string; sender_id: string; kind: string; payload: unknown }>(
        `select id::text,sender_id,kind,payload from retro_pong_signals where room_code=$1 and target_id=$2 and id>$3 order by id asc limit 150`,
        [code, user.id, after]
      );
      const cursor = signals.rows.length ? Number(signals.rows[signals.rows.length - 1].id) : after;
      return NextResponse.json({
        ok: true,
        cursor,
        signals: signals.rows.map((signal) => ({ id: Number(signal.id), senderId: signal.sender_id, kind: signal.kind, payload: signal.payload })),
      });
    }

    throw new Error("Action Pong inconnue.");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erreur inconnue.";
    return NextResponse.json(
      { ok: false, error: message === "AUTH_REQUIRED" ? "Connexion requise." : message },
      { status: message === "AUTH_REQUIRED" ? 401 : 400 }
    );
  }
}
