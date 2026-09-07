import { NextRequest, NextResponse } from "next/server";
import { attachSessionCookie, clearSessionCookie, createSession, deleteCurrentSession, getAuthedUser, hashPassword, verifyPassword } from "@/lib/auth";
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
      const response = NextResponse.json({ ok: true, user: { id, username } });
      attachSessionCookie(response, token);
      return response;
    }
    if (action === "login") {
      const username = cleanUsername(data.username);
      const password = String(data.password ?? "");
      const found = await db().query<{ id: string; username: string; password_hash: string }>(`select id, username, password_hash from retro_users where username_key = $1 limit 1`, [usernameKey(username)]);
      const row = found.rows[0];
      if (!row || !(await verifyPassword(password, row.password_hash))) throw new Error("Pseudo ou mot de passe incorrect.");
      const token = await createSession(row.id);
      const response = NextResponse.json({ ok: true, user: { id: row.id, username: row.username } });
      attachSessionCookie(response, token);
      return response;
    }
    if (action === "logout") {
      await deleteCurrentSession(req);
      const response = NextResponse.json({ ok: true });
      clearSessionCookie(response);
      return response;
    }
    if (action === "me") return NextResponse.json({ ok: true, user: await getAuthedUser(req) });
    throw new Error("Action inconnue.");
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Erreur inconnue." }, { status: 400 });
  }
}
