import { db, ensureSchema } from "./db";
import type { AuthUser } from "./auth";

export async function requireRoomMember(roomCode: string, user: AuthUser) {
  await ensureSchema();
  const result = await db().query<{ code: string; host_user_id: string }>(
    `select r.code, r.host_user_id
     from retro_rooms r
     join retro_room_members m on m.room_code = r.code
     where r.code = $1 and m.user_id = $2 and r.expires_at > now()
     limit 1`,
    [roomCode, user.id]
  );
  const room = result.rows[0];
  if (!room) throw new Error("Tu n'es pas dans cette room.");
  return room;
}
