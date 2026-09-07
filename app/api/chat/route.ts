import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { db, ensureSchema } from "@/lib/db";
import { cleanRoomCode, makeId } from "@/lib/utils";
import { requireRoomMember } from "@/lib/room";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
async function payload(req: NextRequest) { try { return await req.json(); } catch { return {}; } }

async function messages(code: string) {
  const r = await db().query<{ id:string; user_id:string; username:string; message:string; at:string }>(
    `select id,user_id,username,message,round(extract(epoch from created_at)*1000)::bigint as at
     from retro_chat_messages where room_code=$1 order by created_at desc limit 100`, [code]
  );
  return r.rows.reverse().map(x => ({ id:x.id, userId:x.user_id, username:x.username, text:x.message, at:Number(x.at) }));
}

export async function POST(req: NextRequest) {
  try {
    await ensureSchema();
    const user = await requireUser(req);
    const data = await payload(req);
    const code = cleanRoomCode(data.code);
    const action = String(data.action ?? "state");
    await requireRoomMember(code, user);
    if (action === "send") {
      const text = String(data.message ?? "").trim().replace(/\s+/g, " ").slice(0, 240);
      if (!text) throw new Error("Écris un message.");
      await db().query(`insert into retro_chat_messages (id,room_code,user_id,username,message) values ($1,$2,$3,$4,$5)`, [makeId(), code, user.id, user.username, text]);
    } else if (action !== "state") throw new Error("Action inconnue.");
    return NextResponse.json({ ok: true, messages: await messages(code) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erreur inconnue.";
    return NextResponse.json({ ok:false, error: message === "AUTH_REQUIRED" ? "Connexion requise." : message }, { status: message === "AUTH_REQUIRED" ? 401 : 400 });
  }
}
