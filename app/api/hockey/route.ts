import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { cleanup, db, ensureSchema } from "@/lib/db";
import { cleanRoomCode } from "@/lib/utils";
import { requireRoomMember } from "@/lib/room";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Mode = "1v1" | "2v2";
type Side = "left" | "right";
type HockeyPlayer = { userId: string; username: string; side: Side; slot: number };

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
  await db().query(
    `insert into retro_hockey_games (room_code) values ($1) on conflict (room_code) do nothing`,
    [code]
  );
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

async function resetIfAuthorityChanged(code: string, row: HockeyRow) {
  if (row.status !== "playing") return row;
  const hostId = await getRoomHost(code);
  if (row.authority_user_id === hostId) return row;
  await db().query(
    `update retro_hockey_games
     set status = 'lobby', authority_user_id = null, players = '[]'::jsonb,
         left_score = 0, right_score = 0, winner_side = null, updated_at = now()
     where room_code = $1`,
    [code]
  );
  return readGame(code);
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

export async function POST(req: NextRequest) {
  try {
    await ensureSchema();
    await cleanup();
    const user = await requireUser(req);
    const data = await payload(req);
    const code = cleanRoomCode(data.code);
    const action = String(data.action ?? "state");
    await requireRoomMember(code, user);
    await ensureGame(code);

    if (action === "state") {
      const row = await resetIfAuthorityChanged(code, await readGame(code));
      return NextResponse.json({ ok: true, game: publicGame(row) });
    }

    if (action === "configure") {
      const hostId = await getRoomHost(code);
      if (hostId !== user.id) throw new Error("Seul l'hôte peut modifier le mode.");
      const mode: Mode = data.mode === "2v2" ? "2v2" : "1v1";
      const row = await readGame(code);
      if (row.status === "playing") throw new Error("Impossible de changer le mode pendant un match.");
      await db().query(
        `update retro_hockey_games
         set mode = $1, status = 'lobby', authority_user_id = null, players = '[]'::jsonb,
             left_score = 0, right_score = 0, winner_side = null, updated_at = now()
         where room_code = $2`,
        [mode, code]
      );
      return NextResponse.json({ ok: true, game: publicGame(await readGame(code)) });
    }

    if (action === "start") {
      const hostId = await getRoomHost(code);
      if (hostId !== user.id) throw new Error("Seul l'hôte peut lancer le match.");
      const current = await readGame(code);
      const needed = current.mode === "2v2" ? 4 : 2;
      const members = await connectedMembers(code);
      if (members.length < needed) throw new Error(current.mode === "2v2" ? "Il faut 4 joueurs connectés pour le 2v2." : "Il faut 2 joueurs connectés pour le 1v1.");
      const selected = members.slice(0, needed);
      const players: HockeyPlayer[] = selected.map((member, index) => ({
        userId: member.id,
        username: member.username,
        side: index % 2 === 0 ? "left" : "right",
        slot: current.mode === "2v2" ? Math.floor(index / 2) : 0,
      }));
      await db().query(
        `update retro_hockey_games
         set status = 'playing', authority_user_id = $1, players = $2::jsonb,
             left_score = 0, right_score = 0, winner_side = null, updated_at = now()
         where room_code = $3`,
        [hostId, JSON.stringify(players), code]
      );
      await db().query(`delete from retro_hockey_signals where room_code = $1`, [code]);
      return NextResponse.json({ ok: true, game: publicGame(await readGame(code)) });
    }

    if (action === "checkpoint") {
      const hostId = await getRoomHost(code);
      if (hostId !== user.id) throw new Error("Seul l'hôte peut synchroniser le score.");
      const leftScore = Math.max(0, Math.min(99, Number(data.leftScore ?? 0) || 0));
      const rightScore = Math.max(0, Math.min(99, Number(data.rightScore ?? 0) || 0));
      let winnerSide: Side | null = null;
      if (leftScore >= 7) winnerSide = "left";
      if (rightScore >= 7) winnerSide = "right";
      await db().query(
        `update retro_hockey_games
         set left_score = $1, right_score = $2, winner_side = $3,
             status = case when $3::text is null then 'playing' else 'gameover' end,
             updated_at = now()
         where room_code = $4 and authority_user_id = $5`,
        [leftScore, rightScore, winnerSide, code, hostId]
      );
      return NextResponse.json({ ok: true, game: publicGame(await readGame(code)) });
    }

    if (action === "stop") {
      const hostId = await getRoomHost(code);
      if (hostId !== user.id) throw new Error("Seul l'hôte peut arrêter le match.");
      await db().query(
        `update retro_hockey_games
         set status = 'lobby', authority_user_id = null, players = '[]'::jsonb,
             left_score = 0, right_score = 0, winner_side = null, updated_at = now()
         where room_code = $1`,
        [code]
      );
      await db().query(`delete from retro_hockey_signals where room_code = $1`, [code]);
      return NextResponse.json({ ok: true, game: publicGame(await readGame(code)) });
    }

    if (action === "signal") {
      const targetId = String(data.targetId ?? "");
      const kind = String(data.kind ?? "");
      if (!["offer", "answer", "ice"].includes(kind)) throw new Error("Signal hockey invalide.");
      if (!(await db().query(`select 1 from retro_room_members where room_code = $1 and user_id = $2`, [code, targetId])).rowCount) {
        throw new Error("Destinataire introuvable.");
      }
      await db().query(
        `insert into retro_hockey_signals (room_code, sender_id, target_id, kind, payload)
         values ($1, $2, $3, $4, $5::jsonb)`,
        [code, user.id, targetId, kind, JSON.stringify(data.payload ?? {})]
      );
      return NextResponse.json({ ok: true });
    }

    if (action === "poll") {
      const after = Math.max(0, Number(data.after ?? 0) || 0);
      const signals = await db().query<{ id: string; sender_id: string; kind: string; payload: unknown }>(
        `select id::text, sender_id, kind, payload
         from retro_hockey_signals
         where room_code = $1 and target_id = $2 and id > $3
         order by id asc limit 100`,
        [code, user.id, after]
      );
      const cursor = signals.rows.length ? Number(signals.rows[signals.rows.length - 1].id) : after;
      const row = await resetIfAuthorityChanged(code, await readGame(code));
      return NextResponse.json({
        ok: true,
        cursor,
        game: publicGame(row),
        signals: signals.rows.map((s) => ({ id: Number(s.id), senderId: s.sender_id, kind: s.kind, payload: s.payload })),
      });
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
