import { scrypt as scryptCb, randomBytes, timingSafeEqual } from "crypto";
import { promisify } from "util";
import type { NextRequest, NextResponse } from "next/server";
import { db, ensureSchema } from "./db";
import { makeId, makeToken, sha256 } from "./utils";

const scrypt = promisify(scryptCb);
export const SESSION_COOKIE = "retro_session";
const SESSION_DAYS = 30;
export type AuthUser = { id: string; username: string; avatarData: string | null };

export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  return `scrypt$${salt}$${derived.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string) {
  const [kind, salt, hashHex] = stored.split("$");
  if (kind !== "scrypt" || !salt || !hashHex) return false;
  const expected = Buffer.from(hashHex, "hex");
  const actual = (await scrypt(password, salt, expected.length)) as Buffer;
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export async function createSession(userId: string) {
  await ensureSchema();
  const token = makeToken(36);
  await db().query(
    `insert into retro_sessions (id, user_id, token_hash, expires_at)
     values ($1, $2, $3, now() + interval '30 days')`,
    [makeId(), userId, sha256(token)]
  );
  return token;
}

export function attachSessionCookie(response: NextResponse, token: string) {
  response.cookies.set({ name: SESSION_COOKIE, value: token, httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: SESSION_DAYS * 24 * 60 * 60 });
}

export function clearSessionCookie(response: NextResponse) {
  response.cookies.set({ name: SESSION_COOKIE, value: "", httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 0 });
}

export async function getAuthedUser(req: NextRequest, touchPresence = true): Promise<AuthUser | null> {
  await ensureSchema();
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const result = await db().query<{ id: string; username: string; avatarData: string | null }>(
    `select u.id, u.username, u.avatar_data as "avatarData"
     from retro_sessions s join retro_users u on u.id = s.user_id
     where s.token_hash = $1 and s.expires_at > now() limit 1`,
    [sha256(token)]
  );
  const user = result.rows[0] ?? null;
  if (user && touchPresence) await db().query(`update retro_users set last_seen = now() where id = $1`, [user.id]);
  return user;
}

export async function requireUser(req: NextRequest, touchPresence = true) {
  const user = await getAuthedUser(req, touchPresence);
  if (!user) throw new Error("AUTH_REQUIRED");
  return user;
}

export async function deleteCurrentSession(req: NextRequest) {
  await ensureSchema();
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (token) await db().query(`delete from retro_sessions where token_hash = $1`, [sha256(token)]);
}