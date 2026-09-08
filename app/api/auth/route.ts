import { NextRequest, NextResponse } from "next/server";
import { attachSessionCookie, clearSessionCookie, createSession, deleteCurrentSession, getAuthedUser, hashPassword, requireUser, verifyPassword } from "@/lib/auth";
import { db, ensureSchema } from "@/lib/db";
import { cleanUsername, makeId, usernameKey, validateUsername } from "@/lib/utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
async function body(req: NextRequest) { try { return await req.json(); } catch { return {}; } }

export async function POST(req: NextRequest) {
  try {
    await ensureSchema();
    const data = await body(req);
    const action = String(data.action ?? "me");
    if (action === "register") {
      const username = cleanUsername(data.username);
      const password = String(data.password ?? "");
      validateUsername(username);
      if (password.length < 6) throw new Error("Le mot de passe doit faire au moins 6 caractères.");
      if (password.length > 100) throw new Error("Mot de passe trop long.");
      const id = makeId();
      try {
        await db().query(`insert into retro_users (id, username, username_key, password_hash) values ($1,$2,$3,$4)`, [id, username, usernameKey(username), await hashPassword(password)]);
      } catch (e: any) {
        if (e?.code === "23505") throw new Error("Ce pseudo est déjà pris.");
        throw e;
      }
      const token = await createSession(id);
      const response = NextResponse.json({ ok: true, user: { id, username, avatarData: null } });
      attachSessionCookie(response, token);
      return response;
    }
    if (action === "login") {
      const username = cleanUsername(data.username);
      const password = String(data.password ?? "");
      const found = await db().query<{ id: string; username: string; password_hash: string; avatar_data: string | null }>(
        `select id, username, password_hash, avatar_data from retro_users where username_key = $1 limit 1`,
        [usernameKey(username)]
      );
      const row = found.rows[0];
      if (!row || !(await verifyPassword(password, row.password_hash))) throw new Error("Pseudo ou mot de passe incorrect.");
      const token = await createSession(row.id);
      const response = NextResponse.json({ ok: true, user: { id: row.id, username: row.username, avatarData: row.avatar_data } });
      attachSessionCookie(response, token);
      return response;
    }
    if (action === "logout") {
      await deleteCurrentSession(req);
      const response = NextResponse.json({ ok: true });
      clearSessionCookie(response);
      return response;
    }
    if (action === "avatar") {
      const user = await requireUser(req, false);
      const raw = data.avatarData === null ? null : String(data.avatarData ?? "");
      if (raw !== null) {
        if (!/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(raw)) throw new Error("Format d'image invalide.");
        if (raw.length > 220_000) throw new Error("Image trop lourde après compression.");
      }
      await db().query(`update retro_users set avatar_data=$1 where id=$2`, [raw, user.id]);
      return NextResponse.json({ ok: true, user: { id: user.id, username: user.username, avatarData: raw } });
    }
    if (action === "me") return NextResponse.json({ ok: true, user: await getAuthedUser(req) });
    throw new Error("Action inconnue.");
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Erreur inconnue." }, { status: 400 });
  }
}