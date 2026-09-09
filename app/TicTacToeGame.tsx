"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type RoomMember = { id: string; username: string; online: boolean; joined_at: string };
type RoomState = { code: string; hostId: string; currentGame: string; members: RoomMember[]; userId: string };
type Mark = "X" | "O";
type BotDifficulty = "easy" | "normal" | "hard";
type Game = {
  status: "lobby" | "playing" | "gameover";
  playerXId: string | null;
  playerOId: string | null;
  playerXName: string | null;
  playerOName: string | null;
  board: string[];
  turn: Mark;
  winner: Mark | "draw" | null;
  mySymbol: Mark | null;
  botO: boolean;
  botDifficulty: BotDifficulty;
};

const DIFFICULTY_LABEL: Record<BotDifficulty, string> = { easy: "Facile", normal: "Normal", hard: "Difficile" };

async function post(payload: Record<string, unknown>) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 5500);
  try {
    const response = await fetch("/api/game-room", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload), cache: "no-store", signal: controller.signal });
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.error || "Morpion indisponible.");
    return data;
  } finally { window.clearTimeout(timeout); }
}

export default function TicTacToeGame({ room }: { room: RoomState }) {
  const [game, setGame] = useState<Game | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [botDifficulty, setBotDifficulty] = useState<BotDifficulty>("normal");

  const refresh = useCallback(async () => {
    try {
      const data = await post({ action: "tttState", code: room.code });
      setGame(data.game as Game);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Morpion indisponible.");
    }
  }, [room.code]);

  useEffect(() => {
    let alive = true;
    let inFlight = false;
    const poll = async () => {
      if (!alive || inFlight) return;
      inFlight = true;
      try {
        const data = await post({ action: "tttState", code: room.code });
        if (alive) {
          setGame(data.game as Game);
          setError("");
        }
      } catch (err) {
        if (alive) setError(err instanceof Error ? err.message : "Morpion indisponible.");
      } finally {
        inFlight = false;
      }
    };
    void poll();
    const timer = window.setInterval(poll, 450);
    return () => { alive = false; window.clearInterval(timer); };
  }, [room.code]);

  const isHost = room.hostId === room.userId;
  const onlineCount = room.members.filter((member) => member.online).length;
  const myTurn = game?.status === "playing" && game.mySymbol === game.turn;
  const boardKey = game?.board.join("") ?? "";

  useEffect(() => {
    if (!isHost || !game?.botO || game.status !== "playing" || game.turn !== "O") return;
    const timer = window.setTimeout(async () => {
      try {
        const data = await post({ action: "tttBotMove", code: room.code });
        setGame(data.game as Game);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Le bot n'a pas pu jouer.");
      }
    }, game.botDifficulty === "hard" ? 420 : game.botDifficulty === "easy" ? 720 : 560);
    return () => window.clearTimeout(timer);
  }, [boardKey, game?.botDifficulty, game?.botO, game?.status, game?.turn, isHost, room.code]);

  const statusText = useMemo(() => {
    if (!game) return "Chargement…";
    if (game.status === "lobby") return onlineCount >= 2 ? "Prêt à jouer" : "1 place à compléter";
    if (game.status === "gameover") {
      if (game.winner === "draw") return "Match nul";
      const name = game.winner === "X" ? game.playerXName : game.playerOName;
      return `${name ?? game.winner} gagne !`;
    }
    if (game.botO && game.turn === "O") return "Le bot réfléchit…";
    if (!game.mySymbol) return `Tour de ${game.turn === "X" ? game.playerXName ?? "X" : game.playerOName ?? "O"}`;
    return myTurn ? "À toi de jouer" : "Tour de ton adversaire";
  }, [game, myTurn, onlineCount]);

  async function action(name: "tttStart" | "tttReset", extra: Record<string, unknown> = {}) {
    try {
      setBusy(true); setError("");
      const data = await post({ action: name, code: room.code, ...extra });
      setGame(data.game as Game);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur.");
    } finally { setBusy(false); }
  }

  async function move(index: number) {
    if (!game || busy || game.status !== "playing" || !myTurn || game.board[index]) return;
    const before = game;
    const optimisticBoard = [...game.board];
    optimisticBoard[index] = game.mySymbol!;
    setGame({ ...game, board: optimisticBoard, turn: game.mySymbol === "X" ? "O" : "X" });
    try {
      setBusy(true); setError("");
      const data = await post({ action: "tttMove", code: room.code, index });
      setGame(data.game as Game);
    } catch (err) {
      setGame(before);
      setError(err instanceof Error ? err.message : "Coup impossible.");
    } finally { setBusy(false); }
  }

  if (!game) return <section className="tttCard"><div className="spinner"/><p>Chargement du Morpion…</p>{error && <div className="errorBox">{error}</div>}</section>;

  return <section className="tttCard">
    <div className="tttHead">
      <div>
        <span className="kicker">CLASSIQUE · 2 JOUEURS</span>
        <h2>Morpion <small>Tic-Tac-Toe</small></h2>
        <p>Aligne trois symboles sur une ligne, une colonne ou une diagonale.</p>
      </div>
      <div className={`tttStatePill ${game.status}`}>{statusText}</div>
    </div>

    <div className="tttPlayers">
      <div className={`tttPlayer ${game.turn === "X" && game.status === "playing" ? "turn" : ""}`}>
        <b className="x">X</b><span><strong>{game.playerXName ?? "Joueur X"}</strong><small>{game.mySymbol === "X" ? "Toi" : ""}</small></span>
      </div>
      <div className="tttVs">VS</div>
      <div className={`tttPlayer ${game.turn === "O" && game.status === "playing" ? "turn" : ""}`}>
        <b className="o">O</b><span><strong>{game.playerOName ?? "Place libre"}</strong><small>{game.botO ? `Bot · ${DIFFICULTY_LABEL[game.botDifficulty]}` : game.mySymbol === "O" ? "Toi" : ""}</small></span>
      </div>
    </div>

    <div className={`tttBoard ${game.status}`} aria-label="Grille de morpion">
      {game.board.map((value, index) => <button
        key={index}
        className={value ? `filled ${value.toLowerCase()}` : ""}
        disabled={busy || game.status !== "playing" || !myTurn || Boolean(value)}
        onClick={() => void move(index)}
        aria-label={`Case ${index + 1}${value ? ` : ${value}` : ""}`}
      >{value}</button>)}
    </div>

    <div className="tttFooter">
      {game.status === "lobby" && <>
        <div className="tttOnline"><i className={onlineCount >= 2 ? "ready" : ""}/><span>{onlineCount}/2 place{onlineCount > 1 ? "s" : ""} humaine{onlineCount > 1 ? "s" : ""} remplie{onlineCount > 1 ? "s" : ""}</span></div>
        {isHost
          ? <button className="primaryButton" disabled={busy || onlineCount < 2} onClick={() => void action("tttStart")}>{busy ? "Lancement…" : "Lancer la partie"}</button>
          : <small>En attente de l'hôte…</small>}
      </>}
      {game.status === "playing" && <small>{game.mySymbol ? `Tu joues ${game.mySymbol}` : "Tu regardes la partie en spectateur"}</small>}
      {game.status === "gameover" && (isHost
        ? <button className="primaryButton" disabled={busy} onClick={() => void action("tttStart", { fillBots: game.botO, botDifficulty: game.botDifficulty })}>↻ Rejouer</button>
        : <small>En attente de l'hôte pour rejouer…</small>)}
    </div>

    {game.status === "lobby" && isHost && onlineCount === 1 && <div className="botPlayPanel tttBotPanel">
      <div><strong>🤖 Compléter avec un bot</strong><small>Le bot prend simplement la deuxième place manquante.</small></div>
      <select value={botDifficulty} onChange={(event) => setBotDifficulty(event.target.value as BotDifficulty)}>
        <option value="easy">Facile</option><option value="normal">Normal</option><option value="hard">Difficile</option>
      </select>
      <button disabled={busy} onClick={() => void action("tttStart", { fillBots: true, botDifficulty })}>{busy ? "Lancement…" : "Compléter et lancer"}</button>
    </div>}

    {error && <div className="errorBox tttError">{error}<button onClick={() => void refresh()}>↻</button></div>}
  </section>;
}
