import { Pool } from "pg";

declare global {
  var retroGamingPool: Pool | undefined;
  var retroGamingSchemaPromise: Promise<void> | undefined;
}

function normalizedConnectionString(rawUrl: string) {
  try {
    const url = new URL(rawUrl);
    url.searchParams.delete("sslmode");
    url.searchParams.delete("sslcert");
    url.searchParams.delete("sslkey");
    url.searchParams.delete("sslrootcert");
    return url.toString();
  } catch {
    return rawUrl;
  }
}

export function db() {
  const rawUrl = process.env.POSTGRES_URL || process.env.POSTGRES_PRISMA_URL || process.env.POSTGRES_URL_NON_POOLING;
  if (!rawUrl) throw new Error("Supabase n'est pas configuré : POSTGRES_URL est manquant.");
  if (!globalThis.retroGamingPool) {
    globalThis.retroGamingPool = new Pool({
      connectionString: normalizedConnectionString(rawUrl),
      ssl: { rejectUnauthorized: false },
      max: 4,
      idleTimeoutMillis: 20_000,
      connectionTimeoutMillis: 10_000,
    });
  }
  return globalThis.retroGamingPool;
}

export async function ensureSchema() {
  if (!globalThis.retroGamingSchemaPromise) {
    globalThis.retroGamingSchemaPromise = (async () => {
      const p = db();
      await p.query(`
        create table if not exists retro_users (
          id text primary key,
          username text not null,
          username_key text not null unique,
          password_hash text not null,
          created_at timestamptz not null default now(),
          last_seen timestamptz not null default now()
        );
        create table if not exists retro_sessions (
          id text primary key,
          user_id text not null references retro_users(id) on delete cascade,
          token_hash text not null unique,
          created_at timestamptz not null default now(),
          expires_at timestamptz not null
        );
        create table if not exists retro_friend_requests (
          id text primary key,
          sender_id text not null references retro_users(id) on delete cascade,
          receiver_id text not null references retro_users(id) on delete cascade,
          created_at timestamptz not null default now(),
          unique(sender_id, receiver_id),
          check(sender_id <> receiver_id)
        );
        create table if not exists retro_friends (
          user_a text not null references retro_users(id) on delete cascade,
          user_b text not null references retro_users(id) on delete cascade,
          created_at timestamptz not null default now(),
          primary key(user_a, user_b),
          check(user_a < user_b)
        );
        create table if not exists retro_rooms (
          code text primary key,
          host_user_id text not null references retro_users(id) on delete cascade,
          created_at timestamptz not null default now(),
          updated_at timestamptz not null default now(),
          expires_at timestamptz not null
        );
        create table if not exists retro_room_members (
          room_code text not null references retro_rooms(code) on delete cascade,
          user_id text not null references retro_users(id) on delete cascade,
          joined_at timestamptz not null default now(),
          last_seen timestamptz not null default now(),
          primary key(room_code, user_id)
        );
        create table if not exists retro_room_invites (
          id text primary key,
          room_code text not null references retro_rooms(code) on delete cascade,
          sender_id text not null references retro_users(id) on delete cascade,
          receiver_id text not null references retro_users(id) on delete cascade,
          created_at timestamptz not null default now(),
          expires_at timestamptz not null,
          unique(room_code, receiver_id)
        );
        create table if not exists retro_chat_messages (
          id text primary key,
          room_code text not null references retro_rooms(code) on delete cascade,
          user_id text not null references retro_users(id) on delete cascade,
          username text not null,
          message text not null,
          created_at timestamptz not null default now()
        );
        create table if not exists retro_voice_participants (
          room_code text not null references retro_rooms(code) on delete cascade,
          user_id text not null references retro_users(id) on delete cascade,
          username text not null,
          muted boolean not null default false,
          last_seen timestamptz not null default now(),
          primary key(room_code, user_id)
        );
        create table if not exists retro_voice_signals (
          id bigserial primary key,
          room_code text not null references retro_rooms(code) on delete cascade,
          sender_id text not null references retro_users(id) on delete cascade,
          target_id text not null references retro_users(id) on delete cascade,
          kind text not null,
          payload jsonb not null,
          created_at timestamptz not null default now()
        );
        create table if not exists retro_hockey_games (
          room_code text primary key references retro_rooms(code) on delete cascade,
          mode text not null default '1v1',
          status text not null default 'lobby',
          authority_user_id text references retro_users(id) on delete set null,
          players jsonb not null default '[]'::jsonb,
          left_score integer not null default 0,
          right_score integer not null default 0,
          winner_side text,
          updated_at timestamptz not null default now()
        );
        create table if not exists retro_hockey_signals (
          id bigserial primary key,
          room_code text not null references retro_rooms(code) on delete cascade,
          sender_id text not null references retro_users(id) on delete cascade,
          target_id text not null references retro_users(id) on delete cascade,
          kind text not null,
          payload jsonb not null,
          created_at timestamptz not null default now()
        );
        create index if not exists retro_sessions_expires_idx on retro_sessions(expires_at);
        create index if not exists retro_users_last_seen_idx on retro_users(last_seen);
        create index if not exists retro_room_members_room_idx on retro_room_members(room_code, joined_at);
        create index if not exists retro_room_invites_receiver_idx on retro_room_invites(receiver_id, created_at desc);
        create index if not exists retro_chat_room_created_idx on retro_chat_messages(room_code, created_at);
        create index if not exists retro_voice_signal_target_idx on retro_voice_signals(room_code, target_id, id);
        create index if not exists retro_hockey_signal_target_idx on retro_hockey_signals(room_code, target_id, id);
      `);
    })().catch((error) => {
      globalThis.retroGamingSchemaPromise = undefined;
      throw error;
    });
  }
  await globalThis.retroGamingSchemaPromise;
}

export async function cleanup() {
  await ensureSchema();
  const p = db();
  await p.query(`delete from retro_sessions where expires_at < now()`);
  await p.query(`delete from retro_room_invites where expires_at < now()`);
  await p.query(`delete from retro_rooms where expires_at < now()`);
  await p.query(`delete from retro_voice_participants where last_seen < now() - interval '15 seconds'`);
  await p.query(`delete from retro_voice_signals where created_at < now() - interval '10 minutes'`);
  await p.query(`delete from retro_hockey_signals where created_at < now() - interval '10 minutes'`);
}
