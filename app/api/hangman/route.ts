import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { ensureHangmanRow } from "@/lib/game-room";
import { randomHangmanWord } from "@/lib/hangman-words";
import { requireRoomMember } from "@/lib/room";
import { cleanRoomCode } from "@/lib/utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Player = { userId: string; username: string };
type LastAction = { username: string; value: string; kind: "letter" | "word"; correct: boolean };
type Row = {
  room_code: string;
  status: "lobby" | "playing" | "gameover";
  players: unknown;
  word: string;
  guessed_letters: unknown;
  wrong_words: unknown;
  errors: number;
  max_errors: number;
  turn_index: number;
  won: boolean | null;
  last_action: unknown;
};

async function body(req: NextRequest) { try { return await req.json(); } catch { return {}; } }
const normalize = (value: unknown) => String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/[^A-Z]/g, "");
const playersOf = (value: unknown): Player[] => Array.isArray(value) ? value.filter((item): item is Player => Boolean(item && typeof item === "object" && "userId" in item && "username" in item)) : [];
const stringsOf = (value: unknown) => Array.isArray(value) ? value.map(String) : [];

async function getRow(code: string) {
  await ensureHangmanRow(code);
  const result = await db().query<Row>(`select room_code,status,players,word,guessed_letters,wrong_words,errors,max_errors,turn_index,won,last_action from retro_hangman_games where room_code=$1 limit 1`, [code]);
  if (!result.rows[0]) throw new Error("Pendu indisponible.");
  return result.rows[0];
}

async function skipOfflineTurn(row: Row) {
  if (row.status !== "playing") return row;
  const players = playersOf(row.players);
  if (players.length < 2) return row;
  const online = await db().query<{ user_id: string }>(`select user_id from retro_room_members where room_code=$1 and last_seen>now()-interval '15 seconds'`, [row.room_code]);
  const onlineIds = new Set(online.rows.map((entry) => entry.user_id));
  let index = Math.max(0, Number(row.turn_index) || 0) % players.length;
  if (onlineIds.has(players[index]?.userId)) return row;
  for (let offset = 1; offset <= players.length; offset++) {
    const candidate = (index + offset) % players.length;
    if (onlineIds.has(players[candidate].userId)) {
      await db().query(`update retro_hangman_games set turn_index=$1,updated_at=now() where room_code=$2 and status='playing'`, [candidate, row.room_code]);
      return await getRow(row.room_code);
    }
  }
  return row;
}

function output(row: Row, userId: string) {
  const players = playersOf(row.players);
  const letters = stringsOf(row.guessed_letters);
  const guessed = new Set(letters);
  const current = players.length ? players[Math.max(0, Number(row.turn_index) || 0) % players.length] : null;
  const reveal = row.status === "gameover";
  return {
    status: row.status,
    players,
    displayWord: row.word ? row.word.split("").map((letter) => reveal || guessed.has(letter) ? letter : "_").join(" ") : "",
    revealedWord: reveal ? row.word : null,
    guessedLetters: letters,
    wrongWords: stringsOf(row.wrong_words),
    errors: Math.max(0, Number(row.errors) || 0),
    maxErrors: Math.max(4, Math.min(15, Number(row.max_errors) || 7)),
    turnIndex: Math.max(0, Number(row.turn_index) || 0),
    currentPlayerId: current?.userId ?? null,
    currentPlayerName: current?.username ?? null,
    isMyTurn: row.status === "playing" && current?.userId === userId,
    won: row.won,
    lastAction: row.last_action && typeof row.last_action === "object" ? row.last_action as LastAction : null,
  };
}

export async function POST(req: NextRequest) {
  try {
    const data = await body(req);
    const code = cleanRoomCode(data.code);
    if (code.length !== 5) throw new Error("Code de room invalide.");
    const user = await requireUser(req);
    const membership = await requireRoomMember(code, user);
    const action = String(data.action ?? "state");
    await ensureHangmanRow(code);

    if (action === "state") return NextResponse.json({ ok: true, game: output(await skipOfflineTurn(await getRow(code)), user.id) });

    if (action === "configure") {
      if (membership.host_user_id !== user.id) throw new Error("Seul l'hôte peut régler le Pendu.");
      const maxErrors = Math.max(4, Math.min(15, Math.round(Number(data.maxErrors) || 7)));
      await db().query(`update retro_hangman_games set max_errors=$1,status='lobby',players='[]'::jsonb,word='',guessed_letters='[]'::jsonb,wrong_words='[]'::jsonb,errors=0,turn_index=0,won=null,last_action=null,updated_at=now() where room_code=$2`, [maxErrors, code]);
      return NextResponse.json({ ok: true, game: output(await getRow(code), user.id) });
    }

    if (action === "start") {
      if (membership.host_user_id !== user.id) throw new Error("Seul l'hôte peut lancer le Pendu.");
      const members = await db().query<{ id: string; username: string }>(`select u.id,u.username from retro_room_members m join retro_users u on u.id=m.user_id where m.room_code=$1 and m.last_seen>now()-interval '15 seconds' order by case when u.id=$2 then 0 else 1 end,m.joined_at limit 8`, [code, user.id]);
      if (!members.rows.length) throw new Error("Aucun joueur connecté.");
      const players: Player[] = members.rows.map((member) => ({ userId: member.id, username: member.username }));
      const previous = await getRow(code);
      const maxErrors = Math.max(4, Math.min(15, Number(previous.max_errors) || 7));
      await db().query(`update retro_hangman_games set status='playing',players=$1::jsonb,word=$2,guessed_letters='[]'::jsonb,wrong_words='[]'::jsonb,errors=0,max_errors=$3,turn_index=0,won=null,last_action=null,updated_at=now() where room_code=$4`, [JSON.stringify(players), randomHangmanWord(), maxErrors, code]);
      return NextResponse.json({ ok: true, game: output(await getRow(code), user.id) });
    }

    if (action === "guess") {
      const proposal = normalize(data.proposal);
      if (!proposal || proposal.length > 40) throw new Error("Proposition invalide.");
      const client = await db().connect();
      try {
        await client.query("begin");
        const result = await client.query<Row>(`select room_code,status,players,word,guessed_letters,wrong_words,errors,max_errors,turn_index,won,last_action from retro_hangman_games where room_code=$1 for update`, [code]);
        const row = result.rows[0];
        if (!row || row.status !== "playing") throw new Error("La partie n'est pas en cours.");
        const players = playersOf(row.players);
        if (!players.length) throw new Error("Aucun joueur dans la partie.");
        const turnIndex = Math.max(0, Number(row.turn_index) || 0) % players.length;
        const current = players[turnIndex];
        if (current.userId !== user.id) throw new Error(`C'est au tour de ${current.username}.`);
        const guessed = stringsOf(row.guessed_letters);
        const wrongWords = stringsOf(row.wrong_words);
        let errors = Math.max(0, Number(row.errors) || 0);
        const maxErrors = Math.max(4, Math.min(15, Number(row.max_errors) || 7));
        let correct = false;
        const kind: "letter" | "word" = proposal.length === 1 ? "letter" : "word";
        if (kind === "letter") {
          if (guessed.includes(proposal)) throw new Error("Cette lettre a déjà été proposée.");
          guessed.push(proposal);
          correct = row.word.includes(proposal);
          if (!correct) errors += 1;
        } else {
          if (wrongWords.includes(proposal)) throw new Error("Ce mot a déjà été proposé.");
          correct = proposal === row.word;
          if (correct) {
            for (const letter of new Set(row.word.split(""))) if (!guessed.includes(letter)) guessed.push(letter);
          } else {
            wrongWords.push(proposal);
            errors += 1;
          }
        }
        const solved = row.word.split("").every((letter) => guessed.includes(letter));
        const gameover = solved || errors >= maxErrors;
        const nextTurn = gameover ? turnIndex : (turnIndex + 1) % players.length;
        const lastAction: LastAction = { username: user.username, value: proposal, kind, correct };
        await client.query(`update retro_hangman_games set guessed_letters=$1::jsonb,wrong_words=$2::jsonb,errors=$3,turn_index=$4,won=$5,status=$6,last_action=$7::jsonb,updated_at=now() where room_code=$8`, [JSON.stringify(guessed), JSON.stringify(wrongWords), errors, nextTurn, gameover ? solved : null, gameover ? "gameover" : "playing", JSON.stringify(lastAction), code]);
        await client.query("commit");
      } catch (error) {
        try { await client.query("rollback"); } catch {}
        throw error;
      } finally { client.release(); }
      return NextResponse.json({ ok: true, game: output(await getRow(code), user.id) });
    }

    if (action === "stop") {
      if (membership.host_user_id !== user.id) throw new Error("Seul l'hôte peut arrêter le Pendu.");
      await db().query(`update retro_hangman_games set status='lobby',players='[]'::jsonb,word='',guessed_letters='[]'::jsonb,wrong_words='[]'::jsonb,errors=0,turn_index=0,won=null,last_action=null,updated_at=now() where room_code=$1`, [code]);
      return NextResponse.json({ ok: true, game: output(await getRow(code), user.id) });
    }

    throw new Error("Action Pendu inconnue.");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erreur inconnue.";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
