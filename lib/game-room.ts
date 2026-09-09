import { db, ensureSchema } from "./db";

export const ROOM_GAMES = ["hockey", "pong", "rps", "dunkshot", "pool", "tictactoe", "higherlower", "hangman", "flappy"] as const;
export type RoomGameKey = typeof ROOM_GAMES[number];

export function isRoomGameKey(value: unknown): value is RoomGameKey {
  return typeof value === "string" && (ROOM_GAMES as readonly string[]).includes(value);
}

let schemaPromise: Promise<void> | null = null;

export async function ensureGameRoomSchema() {
  await ensureSchema();
  if (!schemaPromise) {
    schemaPromise = db().query(`
      alter table retro_rooms
        add column if not exists current_game text not null default 'hockey';

      create table if not exists retro_tictactoe_games (
        room_code text primary key references retro_rooms(code) on delete cascade,
        status text not null default 'lobby',
        player_x_id text references retro_users(id) on delete set null,
        player_o_id text references retro_users(id) on delete set null,
        board jsonb not null default '["","","","","","","","",""]'::jsonb,
        turn text not null default 'X',
        winner text,
        bot_o boolean not null default false,
        bot_difficulty text not null default 'normal',
        updated_at timestamptz not null default now()
      );
      alter table retro_tictactoe_games add column if not exists bot_o boolean not null default false;
      alter table retro_tictactoe_games add column if not exists bot_difficulty text not null default 'normal';
    `).then(() => undefined).catch((error) => {
      schemaPromise = null;
      throw error;
    });
  }
  await schemaPromise;
}

export async function ensureTicTacToeRow(code: string) {
  await ensureGameRoomSchema();
  await db().query(
    `insert into retro_tictactoe_games (room_code) values ($1)
     on conflict (room_code) do nothing`,
    [code]
  );
}
