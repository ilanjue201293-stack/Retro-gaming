import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { db, ensureSchema } from "@/lib/db";
import { makeId, usernameKey, cleanUsername } from "@/lib/utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function payload(req: NextRequest) { try { return await req.json(); } catch { return {}; } }
function pair(a: string, b: string): [string, string] { return a < b ? [a, b] : [b, a]; }

async function state(userId: string) {
  const friends = await db().query<{ id:string; username:string; online:boolean }>(
    `select u.id, u.username, (u.last_seen > now() - interval '30 seconds') as online
     from retro_friends f
     join retro_users u on u.id = case when f.user_a = $1 then f.user_b else f.user_a end
     where f.user_a = $1 or f.user_b = $1
     order by u.username_key`, [userId]
  );
  const incoming = await db().query<{ id:string; user_id:string; username:string }>(
    `select r.id, u.id as user_id, u.username
     from retro_friend_requests r join retro_users u on u.id = r.sender_id
     where r.receiver_id = $1 order by r.created_at desc`, [userId]
  );
  const outgoing = await db().query<{ id:string; user_id:string; username:string }>(
    `select r.id, u.id as user_id, u.username
     from retro_friend_requests r join retro_users u on u.id = r.receiver_id
     where r.sender_id = $1 order by r.created_at desc`, [userId]
  );
  const invites = await db().query<{ id:string; room_code:string; sender_name:string; created_at:string }>(
    `select i.id, i.room_code, u.username as sender_name, i.created_at::text
     from retro_room_invites i join retro_users u on u.id = i.sender_id
     where i.receiver_id = $1 and i.expires_at > now()
     order by i.created_at desc`, [userId]
  );
  return { friends: friends.rows, incoming: incoming.rows, outgoing: outgoing.rows, roomInvites: invites.rows };
}

export async function POST(req: NextRequest) {
  try {
    await ensureSchema();
    const user = await requireUser(req);
    const data = await payload(req);
    const action = String(data.action ?? "state");
    if (action === "state") return NextResponse.json({ ok: true, ...(await state(user.id)) });

    if (action === "request") {
      const username = cleanUsername(data.username);
      const target = await db().query<{ id:string; username:string }>(`select id, username from retro_users where username_key = $1 limit 1`, [usernameKey(username)]);
      const other = target.rows[0];
      if (!other) throw new Error("Aucun compte avec ce pseudo.");
      if (other.id === user.id) throw new Error("Tu ne peux pas t'ajouter toi-même.");
      const [a,b] = pair(user.id, other.id);
      if ((await db().query(`select 1 from retro_friends where user_a = $1 and user_b = $2`, [a,b])).rowCount) throw new Error("Vous êtes déjà amis.");
      const reverse = await db().query<{id:string}>(`select id from retro_friend_requests where sender_id = $1 and receiver_id = $2 limit 1`, [other.id, user.id]);
      if (reverse.rows[0]) {
        const client = await db().connect();
        try {
          await client.query("begin");
          await client.query(`delete from retro_friend_requests where id = $1`, [reverse.rows[0].id]);
          await client.query(`insert into retro_friends (user_a,user_b) values ($1,$2) on conflict do nothing`, [a,b]);
          await client.query("commit");
        } catch (e) { await client.query("rollback"); throw e; } finally { client.release(); }
      } else {
        try {
          await db().query(`insert into retro_friend_requests (id,sender_id,receiver_id) values ($1,$2,$3)`, [makeId(), user.id, other.id]);
        } catch (e:any) {
          if (e?.code === "23505") throw new Error("Demande déjà envoyée.");
          throw e;
        }
      }
      return NextResponse.json({ ok:true, ...(await state(user.id)) });
    }

    if (action === "accept" || action === "decline") {
      const requestId = String(data.requestId ?? "");
      const found = await db().query<{sender_id:string}>(`select sender_id from retro_friend_requests where id = $1 and receiver_id = $2 limit 1`, [requestId, user.id]);
      const row = found.rows[0];
      if (!row) throw new Error("Demande introuvable.");
      if (action === "accept") {
        const [a,b] = pair(user.id, row.sender_id);
        const client = await db().connect();
        try {
          await client.query("begin");
          await client.query(`delete from retro_friend_requests where id = $1`, [requestId]);
          await client.query(`insert into retro_friends (user_a,user_b) values ($1,$2) on conflict do nothing`, [a,b]);
          await client.query("commit");
        } catch(e) { await client.query("rollback"); throw e; } finally { client.release(); }
      } else {
        await db().query(`delete from retro_friend_requests where id = $1`, [requestId]);
      }
      return NextResponse.json({ ok:true, ...(await state(user.id)) });
    }

    if (action === "remove") {
      const [a,b] = pair(user.id, String(data.friendId ?? ""));
      await db().query(`delete from retro_friends where user_a = $1 and user_b = $2`, [a,b]);
      return NextResponse.json({ ok:true, ...(await state(user.id)) });
    }

    throw new Error("Action inconnue.");
  } catch(error) {
    const message = error instanceof Error ? error.message : "Erreur inconnue.";
    return NextResponse.json({ ok:false, error: message === "AUTH_REQUIRED" ? "Connexion requise." : message }, { status: message === "AUTH_REQUIRED" ? 401 : 400 });
  }
}
