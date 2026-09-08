import { NextRequest, NextResponse } from "next/server";
import { requireUser, SESSION_COOKIE, type AuthUser } from "@/lib/auth";
import { cleanup, db, ensureSchema } from "@/lib/db";
import { cleanRoomCode, makeId, makeRoomCode, sha256 } from "@/lib/utils";
import { requireRoomMember } from "@/lib/room";
import { hockeyConfigure, hockeyStart, hockeyState, hockeyStop, type HockeyMode } from "@/lib/hockey-room";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function payload(req: NextRequest) {
  try { return await req.json(); } catch { return {}; }
}

async function roomState(code: string, userId: string) {
  const room = await db().query<{ code: string; host_user_id: string }>(
    `select code,host_user_id from retro_rooms where code=$1 and expires_at>now() limit 1`,
    [code]
  );
  if (!room.rows[0]) throw new Error("Room introuvable ou expirée.");
  await db().query(`update retro_room_members set last_seen=now() where room_code=$1 and user_id=$2`, [code, userId]);
  await db().query(`update retro_rooms set updated_at=now(),expires_at=now()+interval '12 hours' where code=$1`, [code]);
  const members = await db().query<{ id: string; username: string; online: boolean; joined_at: string }>(
    `select u.id,u.username,(m.last_seen>now()-interval '15 seconds') as online,m.joined_at::text
     from retro_room_members m join retro_users u on u.id=m.user_id
     where m.room_code=$1 order by m.joined_at`,
    [code]
  );
  return { code, hostId: room.rows[0].host_user_id, members: members.rows };
}

function pair(a: string, b: string): [string, string] { return a < b ? [a, b] : [b, a]; }

// Le chemin Hockey est volontairement séparé des migrations/cleanup/presence générales.
// La physique ne passe PAS par cette API : cette route sert seulement au lobby,
// au signaling WebRTC et au secours réseau.
async function fastHockeyUser(req: NextRequest, code: string): Promise<AuthUser> {
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
  const user = result.rows[0];
  if (!user) throw new Error("Tu n'es pas dans cette room.");
  return user;
}

let hockeySignalSchemaPromise: Promise<void> | null = null;
async function ensureHockeySignalSchema() {
  if (!hockeySignalSchemaPromise) {
    hockeySignalSchemaPromise = db().query(`
      create table if not exists retro_hockey_signals (
        id bigserial primary key,
        room_code text not null references retro_rooms(code) on delete cascade,
        sender_id text not null references retro_users(id) on delete cascade,
        target_id text not null references retro_users(id) on delete cascade,
        kind text not null,
        payload jsonb not null,
        created_at timestamptz not null default now()
      );
      create index if not exists retro_hockey_signals_target_idx
        on retro_hockey_signals(room_code,target_id,id);
    `).then(() => undefined).catch((error) => {
      hockeySignalSchemaPromise = null;
      throw error;
    });
  }
  await hockeySignalSchemaPromise;
}

async function roomHost(code: string) {
  const result = await db().query<{ host_user_id: string }>(
    `select host_user_id from retro_rooms where code=$1 and expires_at>now() limit 1`,
    [code]
  );
  if (!result.rows[0]) throw new Error("Room introuvable ou expirée.");
  return result.rows[0].host_user_id;
}

export async function POST(req: NextRequest) {
  try {
    const data = await payload(req);
    const action = String(data.action ?? "state");

    if (action.startsWith("hockey")) {
      const code = cleanRoomCode(data.code);
      const user = await fastHockeyUser(req, code);

      if (action === "hockeyState") {
        return NextResponse.json({ ok: true, game: await hockeyState(code) });
      }

      if (action === "hockeyConfigure") {
        return NextResponse.json({
          ok: true,
          game: await hockeyConfigure(code, user.id, data.mode === "2v2" ? "2v2" : "1v1" as HockeyMode),
        });
      }

      if (action === "hockeyStart") {
        await ensureHockeySignalSchema();
        await db().query(`delete from retro_hockey_signals where room_code=$1`, [code]);
        return NextResponse.json({ ok: true, game: await hockeyStart(code, user.id) });
      }

      if (action === "hockeyStop") {
        const game = await hockeyStop(code, user.id);
        await ensureHockeySignalSchema();
        await db().query(`delete from retro_hockey_signals where room_code=$1`, [code]);
        return NextResponse.json({ ok: true, game });
      }

      if (action === "hockeyCheckpoint") {
        if (await roomHost(code) !== user.id) throw new Error("Seul l'hôte peut synchroniser le score.");
        const leftScore = Math.max(0, Math.min(99, Number(data.leftScore) || 0));
        const rightScore = Math.max(0, Math.min(99, Number(data.rightScore) || 0));
        const winnerSide = leftScore >= 7 ? "left" : rightScore >= 7 ? "right" : null;
        await db().query(
          `update retro_hockey_games
           set left_score=$1,right_score=$2,winner_side=$3,
               status=case when $3::text is null then 'playing' else 'gameover' end,
               updated_at=now()
           where room_code=$4`,
          [leftScore, rightScore, winnerSide, code]
        );
        return NextResponse.json({ ok: true });
      }

      if (action === "hockeySignal") {
        await ensureHockeySignalSchema();
        const targetId = String(data.targetId ?? "");
        const kind = String(data.kind ?? "");
        if (!["offer", "answer", "ice", "input", "state"].includes(kind)) throw new Error("Signal hockey invalide.");
        if (!targetId || targetId === user.id) throw new Error("Destinataire hockey invalide.");
        const member = await db().query(
          `select 1 from retro_room_members where room_code=$1 and user_id=$2 limit 1`,
          [code, targetId]
        );
        if (!member.rowCount) throw new Error("Destinataire introuvable.");
        const raw = JSON.stringify(data.payload ?? {});
        if (raw.length > 50000) throw new Error("Signal hockey trop volumineux.");
        await db().query(
          `insert into retro_hockey_signals (room_code,sender_id,target_id,kind,payload)
           values ($1,$2,$3,$4,$5::jsonb)`,
          [code, user.id, targetId, kind, raw]
        );
        return NextResponse.json({ ok: true });
      }

      if (action === "hockeySignalPoll") {
        await ensureHockeySignalSchema();
        const after = Math.max(0, Number(data.after ?? 0) || 0);
        const signals = await db().query<{ id: string; sender_id: string; kind: string; payload: unknown }>(
          `select id::text,sender_id,kind,payload
           from retro_hockey_signals
           where room_code=$1 and target_id=$2 and id>$3
           order by id asc limit 150`,
          [code, user.id, after]
        );
        const cursor = signals.rows.length ? Number(signals.rows[signals.rows.length - 1].id) : after;
        return NextResponse.json({
          ok: true,
          cursor,
          signals: signals.rows.map((signal) => ({
            id: Number(signal.id),
            senderId: signal.sender_id,
            kind: signal.kind,
            payload: signal.payload,
          })),
        });
      }

      throw new Error("Action hockey inconnue.");
    }

    await ensureSchema();
    await cleanup();
    const user = await requireUser(req);

    if (action === "create") {
      let code = "";
      for (let i = 0; i < 20; i++) {
        const candidate = makeRoomCode();
        const result = await db().query(
          `insert into retro_rooms (code,host_user_id,expires_at)
           values ($1,$2,now()+interval '12 hours') on conflict do nothing`,
          [candidate, user.id]
        );
        if (result.rowCount) { code = candidate; break; }
      }
      if (!code) throw new Error("Impossible de créer une room.");
      await db().query(`insert into retro_room_members (room_code,user_id) values ($1,$2)`, [code, user.id]);
      await db().query(`insert into retro_hockey_games (room_code) values ($1) on conflict (room_code) do nothing`, [code]);
      return NextResponse.json({ ok: true, room: await roomState(code, user.id) });
    }

    if (action === "join") {
      const code = cleanRoomCode(data.code);
      if (code.length !== 5) throw new Error("Code invalide.");
      if (!(await db().query(`select 1 from retro_rooms where code=$1 and expires_at>now()`, [code])).rowCount) {
        throw new Error("Room introuvable ou expirée.");
      }
      await db().query(
        `insert into retro_room_members (room_code,user_id,joined_at,last_seen)
         values ($1,$2,now(),now())
         on conflict (room_code,user_id) do update set last_seen=now()`,
        [code, user.id]
      );
      return NextResponse.json({ ok: true, room: await roomState(code, user.id) });
    }

    if (action === "acceptInvite") {
      const inviteId = String(data.inviteId ?? "");
      const found = await db().query<{ room_code: string }>(
        `select room_code from retro_room_invites
         where id=$1 and receiver_id=$2 and expires_at>now() limit 1`,
        [inviteId, user.id]
      );
      const row = found.rows[0];
      if (!row) throw new Error("Invitation expirée ou introuvable.");
      await db().query(
        `insert into retro_room_members (room_code,user_id) values ($1,$2)
         on conflict (room_code,user_id) do update set last_seen=now()`,
        [row.room_code, user.id]
      );
      await db().query(`delete from retro_room_invites where id=$1`, [inviteId]);
      return NextResponse.json({ ok: true, room: await roomState(row.room_code, user.id) });
    }

    const code = cleanRoomCode(data.code);
    await requireRoomMember(code, user);

    if (action === "state") return NextResponse.json({ ok: true, room: await roomState(code, user.id) });

    if (action === "leave") {
      const current = await db().query<{ host_user_id: string }>(`select host_user_id from retro_rooms where code=$1 limit 1`, [code]);
      await db().query(`delete from retro_room_members where room_code=$1 and user_id=$2`, [code, user.id]);
      await db().query(`delete from retro_voice_participants where room_code=$1 and user_id=$2`, [code, user.id]);
      if (current.rows[0]?.host_user_id === user.id) {
        const next = await db().query<{ user_id: string }>(
          `select user_id from retro_room_members where room_code=$1 order by joined_at limit 1`,
          [code]
        );
        if (next.rows[0]) await db().query(`update retro_rooms set host_user_id=$1 where code=$2`, [next.rows[0].user_id, code]);
        else await db().query(`delete from retro_rooms where code=$1`, [code]);
      }
      return NextResponse.json({ ok: true });
    }

    if (action === "invite") {
      const friendId = String(data.friendId ?? "");
      const [a, b] = pair(user.id, friendId);
      if (!(await db().query(`select 1 from retro_friends where user_a=$1 and user_b=$2`, [a, b])).rowCount) {
        throw new Error("Cette personne n'est pas dans tes amis.");
      }
      await db().query(
        `insert into retro_room_invites (id,room_code,sender_id,receiver_id,expires_at)
         values ($1,$2,$3,$4,now()+interval '2 hours')
         on conflict (room_code,receiver_id)
         do update set sender_id=excluded.sender_id,created_at=now(),expires_at=excluded.expires_at`,
        [makeId(), code, user.id, friendId]
      );
      return NextResponse.json({ ok: true });
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
