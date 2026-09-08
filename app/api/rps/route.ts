import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth";
import { db } from "@/lib/db";
import { cleanRoomCode, sha256 } from "@/lib/utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Side = "left" | "right";
type Choice = "rock" | "paper" | "scissors";
type BotDifficulty = "easy" | "normal" | "hard";
type Phase = "choosing" | "chant" | "reveal" | "gameover";
type Player = { userId: string; username: string; side: Side; isBot?: boolean; difficulty?: BotDifficulty };
type LastResult = { leftChoice: Choice; rightChoice: Choice; winnerSide: Side | null };
type Row = {
  room_code: string;
  status: "lobby" | "playing" | "gameover";
  players: unknown;
  rounds_total: number;
  round_index: number;
  left_score: number;
  right_score: number;
  choices: unknown;
  phase: Phase;
  phase_started_at: string | null;
  phase_ends_at: string | null;
  last_result: unknown;
  winner_side: Side | null;
};

const CHOICE_MS = 3000;
const CHOICE_NETWORK_GRACE_MS = 1500;
const CHANT_MS = 2100;
const REVEAL_MS = 1800;
const VALID_CHOICES = new Set<Choice>(["rock", "paper", "scissors"]);

let schemaPromise: Promise<void> | null = null;
async function ensureSchema() {
  if (!schemaPromise) {
    schemaPromise = db().query(`
      create table if not exists retro_rps_games (
        room_code text primary key references retro_rooms(code) on delete cascade,
        status text not null default 'lobby',
        players jsonb not null default '[]'::jsonb,
        rounds_total integer not null default 5,
        round_index integer not null default 0,
        left_score integer not null default 0,
        right_score integer not null default 0,
        choices jsonb not null default '{}'::jsonb,
        phase text not null default 'choosing',
        phase_started_at timestamptz,
        phase_ends_at timestamptz,
        last_result jsonb,
        winner_side text,
        updated_at timestamptz not null default now()
      );
    `).then(() => undefined).catch((error) => {
      schemaPromise = null;
      throw error;
    });
  }
  await schemaPromise;
}

async function bodyOf(req: NextRequest) {
  try { return await req.json(); } catch { return {}; }
}

async function authInRoom(req: NextRequest, code: string) {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (!token) throw new Error("AUTH_REQUIRED");
  const result = await db().query<{ id: string; username: string }>(
    `select u.id,u.username
     from retro_sessions s
     join retro_users u on u.id=s.user_id
     join retro_room_members m on m.user_id=u.id and m.room_code=$2
     join retro_rooms r on r.code=m.room_code
     where s.token_hash=$1 and s.expires_at>now() and r.expires_at>now()
     limit 1`,
    [sha256(token), code]
  );
  if (!result.rows[0]) throw new Error("Tu n'es pas dans cette room.");
  return result.rows[0];
}

async function hostId(code: string) {
  const result = await db().query<{ host_user_id: string }>(
    `select host_user_id from retro_rooms where code=$1 and expires_at>now() limit 1`,
    [code]
  );
  if (!result.rows[0]) throw new Error("Room introuvable ou expirée.");
  return result.rows[0].host_user_id;
}

async function ensureGame(code: string) {
  await ensureSchema();
  await db().query(`insert into retro_rps_games (room_code) values ($1) on conflict (room_code) do nothing`, [code]);
}

function parsePlayers(raw: unknown): Player[] {
  return Array.isArray(raw) ? raw as Player[] : [];
}
function parseChoices(raw: unknown): Record<string, Choice> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const output: Record<string, Choice> = {};
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    if (VALID_CHOICES.has(value as Choice)) output[id] = value as Choice;
  }
  return output;
}
function parseResult(raw: unknown): LastResult | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const value = raw as Partial<LastResult>;
  if (!VALID_CHOICES.has(value.leftChoice as Choice) || !VALID_CHOICES.has(value.rightChoice as Choice)) return null;
  return {
    leftChoice: value.leftChoice as Choice,
    rightChoice: value.rightChoice as Choice,
    winnerSide: value.winnerSide === "left" || value.winnerSide === "right" ? value.winnerSide : null,
  };
}
function randomChoice(): Choice {
  return (["rock", "paper", "scissors"] as Choice[])[Math.floor(Math.random() * 3)];
}
function counterChoice(choice: Choice): Choice { return choice === "rock" ? "paper" : choice === "paper" ? "scissors" : "rock"; }
function losingChoice(choice: Choice): Choice { return choice === "rock" ? "scissors" : choice === "paper" ? "rock" : "paper"; }
function botChoiceAgainst(choice: Choice, difficulty: BotDifficulty): Choice {
  if (difficulty === "easy" && Math.random() < 0.5) return losingChoice(choice);
  if (difficulty === "hard" && Math.random() < 0.42) return counterChoice(choice);
  return randomChoice();
}

function roundWinner(left: Choice, right: Choice): Side | null {
  if (left === right) return null;
  if (
    (left === "rock" && right === "scissors") ||
    (left === "paper" && right === "rock") ||
    (left === "scissors" && right === "paper")
  ) return "left";
  return "right";
}

async function getRow(code: string) {
  await ensureGame(code);
  const result = await db().query<Row>(
    `select room_code,status,players,rounds_total,round_index,left_score,right_score,choices,phase,
            phase_started_at::text,phase_ends_at::text,last_result,winner_side
     from retro_rps_games where room_code=$1 limit 1`,
    [code]
  );
  if (!result.rows[0]) throw new Error("Pierre-Feuille-Ciseaux indisponible.");
  return result.rows[0];
}

async function advance(code: string) {
  const client = await db().connect();
  try {
    await client.query("begin");
    const result = await client.query<Row>(
      `select room_code,status,players,rounds_total,round_index,left_score,right_score,choices,phase,
              phase_started_at::text,phase_ends_at::text,last_result,winner_side
       from retro_rps_games where room_code=$1 for update`,
      [code]
    );
    const row = result.rows[0];
    if (!row || row.status !== "playing") {
      await client.query("commit");
      return row ?? await getRow(code);
    }

    const now = Date.now();
    const deadline = row.phase_ends_at ? new Date(row.phase_ends_at).getTime() : 0;
    const effectiveDeadline = row.phase === "choosing" ? deadline + CHOICE_NETWORK_GRACE_MS : deadline;
    if (!deadline || now < effectiveDeadline) {
      await client.query("commit");
      return row;
    }

    const players = parsePlayers(row.players);
    if (players.length !== 2) {
      await client.query(`update retro_rps_games set status='lobby',players='[]'::jsonb,updated_at=now() where room_code=$1`, [code]);
      await client.query("commit");
      return await getRow(code);
    }

    if (row.phase === "choosing") {
      const choices = parseChoices(row.choices);
      choices[players[0].userId] ||= randomChoice();
      choices[players[1].userId] ||= randomChoice();
      await client.query(
        `update retro_rps_games set choices=$1::jsonb,phase='chant',phase_started_at=now(),phase_ends_at=now()+($2 * interval '1 millisecond'),updated_at=now() where room_code=$3`,
        [JSON.stringify(choices), CHANT_MS, code]
      );
    } else if (row.phase === "chant") {
      const choices = parseChoices(row.choices);
      const leftChoice = choices[players[0].userId] || randomChoice();
      const rightChoice = choices[players[1].userId] || randomChoice();
      const winner = roundWinner(leftChoice, rightChoice);
      const leftScore = row.left_score + (winner === "left" ? 1 : 0);
      const rightScore = row.right_score + (winner === "right" ? 1 : 0);
      const lastResult: LastResult = { leftChoice, rightChoice, winnerSide: winner };
      await client.query(
        `update retro_rps_games set left_score=$1,right_score=$2,round_index=round_index+1,last_result=$3::jsonb,
         phase='reveal',phase_started_at=now(),phase_ends_at=now()+($4 * interval '1 millisecond'),updated_at=now()
         where room_code=$5`,
        [leftScore, rightScore, JSON.stringify(lastResult), REVEAL_MS, code]
      );
    } else if (row.phase === "reveal") {
      if (row.round_index >= row.rounds_total) {
        const winnerSide: Side | null = row.left_score === row.right_score ? null : row.left_score > row.right_score ? "left" : "right";
        await client.query(
          `update retro_rps_games set status='gameover',phase='gameover',winner_side=$1,phase_started_at=now(),phase_ends_at=null,updated_at=now() where room_code=$2`,
          [winnerSide, code]
        );
      } else {
        await client.query(
          `update retro_rps_games set choices='{}'::jsonb,last_result=null,phase='choosing',phase_started_at=now(),phase_ends_at=now()+($2 * interval '1 millisecond'),updated_at=now() where room_code=$1`,
          [code, CHOICE_MS]
        );
      }
    }

    await client.query("commit");
    return await getRow(code);
  } catch (error) {
    try { await client.query("rollback"); } catch {}
    throw error;
  } finally {
    client.release();
  }
}

async function recordChoice(code: string, userId: string, choice: Choice, expectedRoundIndex: number) {
  await ensureGame(code);
  const client = await db().connect();
  try {
    await client.query("begin");
    const locked = await client.query<Row>(
      `select room_code,status,players,rounds_total,round_index,left_score,right_score,choices,phase,
              phase_started_at::text,phase_ends_at::text,last_result,winner_side
       from retro_rps_games where room_code=$1 for update`,
      [code]
    );
    const row = locked.rows[0];
    if (!row) throw new Error("Pierre-Feuille-Ciseaux indisponible.");
    const players = parsePlayers(row.players);
    if (!players.some((player) => player.userId === userId)) throw new Error("Tu ne joues pas cette partie.");
    if (row.round_index !== expectedRoundIndex) throw new Error("Cette manche est déjà terminée. Choisis pour la suivante.");

    // Un clic reçu juste après 0 s peut être arrivé à temps côté joueur mais subir
    // quelques centaines de ms de réseau. On lui laisse donc une petite marge.
    const deadline = row.phase_ends_at ? new Date(row.phase_ends_at).getTime() : 0;
    const stillAccepting = row.status === "playing" && row.phase === "choosing" && (!deadline || Date.now() <= deadline + CHOICE_NETWORK_GRACE_MS);
    if (!stillAccepting) {
      await client.query("commit");
      return row;
    }

    // JSONB concatène la nouvelle clé sans relire/réécrire les choix de l'autre joueur.
    // Avec le verrou de ligne, deux clics simultanés ne peuvent plus s'écraser.
    const bot = players.find((player) => player.isBot);
    const botChoice = bot ? botChoiceAgainst(choice, bot.difficulty ?? "normal") : null;
    const updated = bot && botChoice ? await client.query<Row>(
      `update retro_rps_games
       set choices=coalesce(choices,'{}'::jsonb) || jsonb_build_object($2::text,$3::text) || jsonb_build_object($4::text,$5::text),updated_at=now()
       where room_code=$1
       returning room_code,status,players,rounds_total,round_index,left_score,right_score,choices,phase,
                 phase_started_at::text,phase_ends_at::text,last_result,winner_side`,
      [code, userId, choice, bot.userId, botChoice]
    ) : await client.query<Row>(
      `update retro_rps_games
       set choices=coalesce(choices,'{}'::jsonb) || jsonb_build_object($2::text,$3::text),updated_at=now()
       where room_code=$1
       returning room_code,status,players,rounds_total,round_index,left_score,right_score,choices,phase,
                 phase_started_at::text,phase_ends_at::text,last_result,winner_side`,
      [code, userId, choice]
    );
    await client.query("commit");
    return updated.rows[0] ?? row;
  } catch (error) {
    try { await client.query("rollback"); } catch {}
    throw error;
  } finally {
    client.release();
  }
}

function output(row: Row, userId: string) {
  const players = parsePlayers(row.players);
  const choices = parseChoices(row.choices);
  const lastResult = parseResult(row.last_result);
  const revealChoices = row.phase === "reveal" || row.phase === "gameover";
  return {
    status: row.status,
    players,
    roundsTotal: Number(row.rounds_total || 5),
    roundIndex: Number(row.round_index || 0),
    leftScore: Number(row.left_score || 0),
    rightScore: Number(row.right_score || 0),
    phase: row.phase,
    phaseStartedAt: row.phase_started_at ? new Date(row.phase_started_at).getTime() : null,
    phaseEndsAt: row.phase_ends_at ? new Date(row.phase_ends_at).getTime() : null,
    myChoice: choices[userId] ?? null,
    lastResult: revealChoices ? lastResult : null,
    winnerSide: row.winner_side,
  };
}

export async function POST(req: NextRequest) {
  try {
    const data = await bodyOf(req);
    const action = String(data.action ?? "state");
    const code = cleanRoomCode(data.code);
    const user = await authInRoom(req, code);
    await ensureSchema();

    if (action === "state") {
      const row = await advance(code);
      return NextResponse.json({ ok: true, game: output(row, user.id) });
    }

    if (action === "configure") {
      if (await hostId(code) !== user.id) throw new Error("Seul l'hôte peut régler Pierre-Feuille-Ciseaux.");
      const rounds = Math.max(1, Math.min(15, Math.round(Number(data.roundsTotal) || 5)));
      await ensureGame(code);
      await db().query(
        `update retro_rps_games set rounds_total=$1,status='lobby',players='[]'::jsonb,round_index=0,left_score=0,right_score=0,choices='{}'::jsonb,phase='choosing',phase_started_at=null,phase_ends_at=null,last_result=null,winner_side=null,updated_at=now() where room_code=$2`,
        [rounds, code]
      );
      return NextResponse.json({ ok: true, game: output(await getRow(code), user.id) });
    }

    if (action === "start") {
      if (await hostId(code) !== user.id) throw new Error("Seul l'hôte peut lancer Pierre-Feuille-Ciseaux.");
      await ensureGame(code);
      const members = await db().query<{ id: string; username: string }>(
        `select u.id,u.username from retro_room_members m join retro_users u on u.id=m.user_id
         where m.room_code=$1 and m.last_seen>now()-interval '15 seconds' order by m.joined_at`,
        [code]
      );
      const requestedBot = String(data.botDifficulty ?? "");
      const botDifficulty: BotDifficulty | null = requestedBot === "easy" || requestedBot === "normal" || requestedBot === "hard" ? requestedBot : null;
      let players: Player[];
      if (botDifficulty) {
        const human = members.rows.find((member) => member.id === user.id) ?? members.rows[0];
        if (!human) throw new Error("Tu dois être dans la room pour jouer contre le bot.");
        players = [
          { userId: human.id, username: human.username, side: "left" },
          { userId: "bot:rps", username: "BOT", side: "right", isBot: true, difficulty: botDifficulty },
        ];
      } else {
        if (members.rows.length !== 2) throw new Error("Pierre-Feuille-Ciseaux se joue avec exactement 2 joueurs connectés.");
        players = [
          { userId: members.rows[0].id, username: members.rows[0].username, side: "left" },
          { userId: members.rows[1].id, username: members.rows[1].username, side: "right" },
        ];
      }
      await db().query(
        `update retro_rps_games set status='playing',players=$1::jsonb,round_index=0,left_score=0,right_score=0,
         choices='{}'::jsonb,phase='choosing',phase_started_at=now(),phase_ends_at=now()+($2 * interval '1 millisecond'),last_result=null,winner_side=null,updated_at=now()
         where room_code=$3`,
        [JSON.stringify(players), CHOICE_MS, code]
      );
      return NextResponse.json({ ok: true, game: output(await getRow(code), user.id) });
    }

    if (action === "choose") {
      const choice = String(data.choice ?? "") as Choice;
      if (!VALID_CHOICES.has(choice)) throw new Error("Choix invalide.");
      const roundIndex = Math.max(0, Math.round(Number(data.roundIndex)));
      const row = await recordChoice(code, user.id, choice, roundIndex);
      return NextResponse.json({ ok: true, game: output(row, user.id) });
    }

    if (action === "stop") {
      if (await hostId(code) !== user.id) throw new Error("Seul l'hôte peut arrêter la partie.");
      await ensureGame(code);
      await db().query(
        `update retro_rps_games set status='lobby',players='[]'::jsonb,round_index=0,left_score=0,right_score=0,choices='{}'::jsonb,phase='choosing',phase_started_at=null,phase_ends_at=null,last_result=null,winner_side=null,updated_at=now() where room_code=$1`,
        [code]
      );
      return NextResponse.json({ ok: true, game: output(await getRow(code), user.id) });
    }

    throw new Error("Action Pierre-Feuille-Ciseaux inconnue.");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erreur inconnue.";
    return NextResponse.json({ ok: false, error: message === "AUTH_REQUIRED" ? "Connexion requise." : message }, { status: message === "AUTH_REQUIRED" ? 401 : 400 });
  }
}
