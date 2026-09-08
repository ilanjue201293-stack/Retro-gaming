import { db } from "./db";

declare global {
  var retroHockeyV3SchemaPromise: Promise<void> | undefined;
}

export async function ensureHockeyV3Schema() {
  if (!globalThis.retroHockeyV3SchemaPromise) {
    globalThis.retroHockeyV3SchemaPromise = db().query(`
      create table if not exists retro_hockey_inputs (
        room_code text not null references retro_rooms(code) on delete cascade,
        user_id text not null references retro_users(id) on delete cascade,
        x double precision not null,
        y double precision not null,
        vx double precision not null default 0,
        vy double precision not null default 0,
        updated_at timestamptz not null default now(),
        primary key(room_code, user_id)
      );

      create table if not exists retro_hockey_runtime (
        room_code text primary key references retro_rooms(code) on delete cascade,
        puck_x double precision not null default 0.5,
        puck_y double precision not null default 0.5,
        puck_vx double precision not null default 0,
        puck_vy double precision not null default 0,
        paddles jsonb not null default '{}'::jsonb,
        left_score integer not null default 0,
        right_score integer not null default 0,
        winner_side text,
        pause_until_ms bigint not null default 0,
        last_step_ms bigint not null default 0,
        version bigint not null default 0
      );

      create index if not exists retro_hockey_inputs_room_idx
        on retro_hockey_inputs(room_code, updated_at desc);
    `).then(() => undefined).catch((error) => {
      globalThis.retroHockeyV3SchemaPromise = undefined;
      throw error;
    });
  }
  await globalThis.retroHockeyV3SchemaPromise;
}
