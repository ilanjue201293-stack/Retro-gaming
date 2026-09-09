import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { ensureGameRoomSchema, ensureTicTacToeRow, isRoomGameKey } from "@/lib/game-room";
import { requireRoomMember } from "@/lib/room";
import { cleanRoomCode } from "@/lib/utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Mark = "X" | "O";
type Board = string[];
type BotDifficulty = "easy" | "normal" | "hard";

async function body(req: NextRequest) {
  try { return await req.json(); } catch { return {}; }
}

function winner(board: Board): Mark | "draw" | null {
  const lines = [
    [0,1,2],[3,4,5],[6,7,8],
    [0,3,6],[1,4,7],[2,5,8],
    [0,4,8],[2,4,6],
  ];
  for (const [a,b,c] of lines) {
    const value = board[a];
    if (value && value === board[b] && value === board[c]) return value as Mark;
  }
  return board.every(Boolean) ? "draw" : null;
}

function difficulty(value: unknown): BotDifficulty {
  return value === "easy" || value === "hard" ? value : "normal";
}

function findWinningMove(board: Board, mark: Mark) {
  for (let index = 0; index < 9; index++) {
    if (board[index]) continue;
    const next = [...board];
    next[index] = mark;
    if (winner(next) === mark) return index;
  }
  return null;
}

function randomChoice(values: number[]) {
  return values[Math.floor(Math.random() * values.length)] ?? null;
}

function botMove(board: Board, level: BotDifficulty) {
  const free = board.map((value, index) => value ? -1 : index).filter((index) => index >= 0);
  if (!free.length) return null;

  if (level === "easy") {
    if (Math.random() < 0.2) {
      const block = findWinningMove(board, "X");
      if (block !== null) return block;
    }
    return randomChoice(free);
  }

  const winning = findWinningMove(board, "O");
  if (winning !== null) return winning;
  const block = findWinningMove(board, "X");
  if (block !== null && (level === "hard" || Math.random() < 0.72)) return block;

  if (level === "normal" && Math.random() < 0.32) return randomChoice(free);
  if (!board[4]) return 4;
  const oppositePairs: [number, number][] = [[0,8],[2,6]];
  for (const [a,b] of oppositePairs) {
    if (board[a] === "X" && !board[b]) return b;
    if (board[b] === "X" && !board[a]) return a;
  }
  const corners = [0,2,6,8].filter((index) => !board[index]);
  if (corners.length) return randomChoice(corners);
  return randomChoice(free);
}

async function roomState(code: string, userId: string) {
  const room = await db().query<{ host_user_id: string; current_game: string }>(
    `select host_user_id,current_game from retro_rooms where code=$1 and expires_at>now() limit 1`,
    [code]
  );
  if (!room.rows[0]) throw new Error("Room introuvable ou expirée.");
  await db().query(`update retro_room_members set last_seen=now() where room_code=$1 and user_id=$2`, [code, userId]);
  const members = await db().query<{ id: string; username: string; online: boolean; joined_at: string }>(
    `select u.id,u.username,(m.last_seen>now()-interval '15 seconds') as online,m.joined_at::text
     from retro_room_members m join retro_users u on u.id=m.user_id
     where m.room_code=$1 order by m.joined_at`,
    [code]
  );
  return {
    code,
    hostId: room.rows[0].host_user_id,
    currentGame: isRoomGameKey(room.rows[0].current_game) ? room.rows[0].current_game : "hockey",
    members: members.rows,
    userId,
  };
}

async function ticTacToeState(code: string, userId: string) {
  await ensureTicTacToeRow(code);
  const result = await db().query<{
    status: "lobby" | "playing" | "gameover";
    player_x_id: string | null;
    player_o_id: string | null;
    board: Board;
    turn: Mark;
    winner: Mark | "draw" | null;
    bot_o: boolean;
    bot_difficulty: BotDifficulty;
  }>(
    `select status,player_x_id,player_o_id,board,turn,winner,bot_o,bot_difficulty
     from retro_tictactoe_games where room_code=$1 limit 1`,
    [code]
  );
  const row = result.rows[0];
  if (!row) throw new Error("Morpion indisponible.");
  const ids = [row.player_x_id, row.player_o_id].filter(Boolean) as string[];
  const users = ids.length
    ? await db().query<{ id: string; username: string }>(`select id,username from retro_users where id = any($1::text[])`, [ids])
    : { rows: [] as { id: string; username: string }[] };
  const names = new Map(users.rows.map((item) => [item.id, item.username]));
  return {
    status: row.status,
    playerXId: row.player_x_id,
    playerOId: row.player_o_id,
    playerXName: row.player_x_id ? names.get(row.player_x_id) ?? "Joueur X" : null,
    playerOName: row.bot_o ? "BOT" : row.player_o_id ? names.get(row.player_o_id) ?? "Joueur O" : null,
    board: Array.isArray(row.board) ? row.board : ["","","","","","","","",""],
    turn: row.turn,
    winner: row.winner,
    mySymbol: row.player_x_id === userId ? "X" : row.player_o_id === userId ? "O" : null,
    botO: Boolean(row.bot_o),
    botDifficulty: difficulty(row.bot_difficulty),
  };
}

export async function POST(req: NextRequest) {
  try {
    const data = await body(req);
    const action = String(data.action ?? "state");
    const code = cleanRoomCode(data.code);
    if (code.length !== 5) throw new Error("Code de room invalide.");

    const user = await requireUser(req);
    await ensureGameRoomSchema();
    const membership = await requireRoomMember(code, user);

    if (action === "state") {
      return NextResponse.json({ ok: true, room: await roomState(code, user.id) });
    }

    if (action === "setGame") {
      const game = data.game;
      if (!isRoomGameKey(game)) throw new Error("Jeu inconnu.");
      if (membership.host_user_id !== user.id) throw new Error("Seul l'hôte peut changer de jeu.");
      await db().query(`update retro_rooms set current_game=$1,updated_at=now() where code=$2`, [game, code]);
      if (game === "tictactoe") await ensureTicTacToeRow(code);
      return NextResponse.json({ ok: true, room: await roomState(code, user.id) });
    }

    if (action === "tttState") {
      return NextResponse.json({ ok: true, game: await ticTacToeState(code, user.id) });
    }

    if (action === "tttStart") {
      if (membership.host_user_id !== user.id) throw new Error("Seul l'hôte peut lancer la partie.");
      await ensureTicTacToeRow(code);
      const players = await db().query<{ user_id: string }>(
        `select user_id from retro_room_members
         where room_code=$1 and last_seen>now()-interval '15 seconds'
         order by case when user_id=$2 then 0 else 1 end, joined_at
         limit 2`,
        [code, user.id]
      );
      if (!players.rows.length) throw new Error("Aucun joueur disponible.");
      const fillBots = Boolean(data.fillBots);
      const x = players.rows[0].user_id;
      const humanO = players.rows[1]?.user_id ?? null;
      const botO = !humanO && fillBots;
      if (!humanO && !botO) throw new Error("Il manque un joueur. Utilise « Compléter avec un bot ».");
      const level = difficulty(data.botDifficulty);
      await db().query(
        `update retro_tictactoe_games
         set status='playing',player_x_id=$1,player_o_id=$2,bot_o=$3,bot_difficulty=$4,
             board='["","","","","","","","",""]'::jsonb,
             turn='X',winner=null,updated_at=now()
         where room_code=$5`,
        [x, humanO, botO, level, code]
      );
      return NextResponse.json({ ok: true, game: await ticTacToeState(code, user.id) });
    }

    if (action === "tttMove") {
      await ensureTicTacToeRow(code);
      const index = Math.trunc(Number(data.index));
      if (!Number.isInteger(index) || index < 0 || index > 8) throw new Error("Case invalide.");

      const client = await db().connect();
      try {
        await client.query("begin");
        const result = await client.query<{
          status: string;
          player_x_id: string | null;
          player_o_id: string | null;
          board: Board;
          turn: Mark;
          bot_o: boolean;
        }>(
          `select status,player_x_id,player_o_id,board,turn,bot_o
           from retro_tictactoe_games where room_code=$1 for update`,
          [code]
        );
        const row = result.rows[0];
        if (!row || row.status !== "playing") throw new Error("La partie n'est pas en cours.");
        const mark: Mark | null = row.player_x_id === user.id ? "X" : row.player_o_id === user.id ? "O" : null;
        if (!mark) throw new Error("Tu es spectateur de cette partie.");
        if (row.bot_o && mark === "O") throw new Error("Cette place est occupée par le bot.");
        if (row.turn !== mark) throw new Error("Ce n'est pas ton tour.");
        const board = Array.isArray(row.board) ? [...row.board] : ["","","","","","","","",""];
        if (board[index]) throw new Error("Cette case est déjà prise.");
        board[index] = mark;
        const resultWinner = winner(board);
        await client.query(
          `update retro_tictactoe_games
           set board=$1::jsonb,
               turn=$2,
               winner=$3,
               status=$4,
               updated_at=now()
           where room_code=$5`,
          [JSON.stringify(board), mark === "X" ? "O" : "X", resultWinner, resultWinner ? "gameover" : "playing", code]
        );
        await client.query("commit");
      } catch (error) {
        await client.query("rollback");
        throw error;
      } finally {
        client.release();
      }
      return NextResponse.json({ ok: true, game: await ticTacToeState(code, user.id) });
    }

    if (action === "tttBotMove") {
      if (membership.host_user_id !== user.id) throw new Error("Seul l'hôte synchronise le bot.");
      const client = await db().connect();
      try {
        await client.query("begin");
        const result = await client.query<{
          status: string;
          board: Board;
          turn: Mark;
          bot_o: boolean;
          bot_difficulty: BotDifficulty;
        }>(
          `select status,board,turn,bot_o,bot_difficulty
           from retro_tictactoe_games where room_code=$1 for update`,
          [code]
        );
        const row = result.rows[0];
        if (!row || row.status !== "playing" || !row.bot_o || row.turn !== "O") {
          await client.query("rollback");
          return NextResponse.json({ ok: true, game: await ticTacToeState(code, user.id) });
        }
        const board = Array.isArray(row.board) ? [...row.board] : ["","","","","","","","",""];
        const index = botMove(board, difficulty(row.bot_difficulty));
        if (index !== null) board[index] = "O";
        const resultWinner = winner(board);
        await client.query(
          `update retro_tictactoe_games
           set board=$1::jsonb,turn='X',winner=$2,status=$3,updated_at=now()
           where room_code=$4`,
          [JSON.stringify(board), resultWinner, resultWinner ? "gameover" : "playing", code]
        );
        await client.query("commit");
      } catch (error) {
        try { await client.query("rollback"); } catch {}
        throw error;
      } finally {
        client.release();
      }
      return NextResponse.json({ ok: true, game: await ticTacToeState(code, user.id) });
    }

    if (action === "tttReset") {
      if (membership.host_user_id !== user.id) throw new Error("Seul l'hôte peut relancer la partie.");
      await ensureTicTacToeRow(code);
      await db().query(
        `update retro_tictactoe_games
         set status='lobby',player_x_id=null,player_o_id=null,bot_o=false,
             board='["","","","","","","","",""]'::jsonb,
             turn='X',winner=null,updated_at=now()
         where room_code=$1`,
        [code]
      );
      return NextResponse.json({ ok: true, game: await ticTacToeState(code, user.id) });
    }

    throw new Error("Action inconnue.");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erreur inconnue.";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
