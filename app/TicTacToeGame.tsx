"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type RoomMember = { id: string; username: string; online: boolean; joined_at: string };
type RoomState = { code: string; hostId: string; currentGame: string; members: RoomMember[]; userId: string };
type Mark = "X" | "O";
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
};

async function post(payload: Record<string, unknown>) {
  const response = await fetch("/api/game-room", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    cache: "no-store",
  });
  const data = await response.json();
  if (!response.ok || !data.ok) throw new Error(data.error || "Morpion indisponible.");
  return data;
}

export default function TicTacToeGame({ room }: { room: RoomState }) {
  const [game, setGame] = useState<Game | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

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

  const statusText = useMemo(() => {
    if (!game) return "Chargement…";
    if (game.status === "lobby") return onlineCount >= 2 ? "Prêt à jouer" : "En attente d'un deuxième joueur";
    if (game.status === "gameover") {
      if (game.winner === "draw") return "Match nul";
      const name = game.winner === "X" ? game.playerXName : game.playerOName;
      return `${name ?? game.winner} gagne !`;
    }
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
        <b className="o">O</b><span><strong>{game.playerOName ?? "Joueur O"}</strong><small>{game.mySymbol === "O" ? "Toi" : ""}</small></span>
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
        <div className="tttOnline"><i className={onlineCount >= 2 ? "ready" : ""}/><span>{onlineCount} joueur{onlineCount > 1 ? "s" : ""} en ligne</span></div>
        {isHost
          ? <button className="primaryButton" disabled={busy || onlineCount < 2} onClick={() => void action("tttStart")}>{busy ? "Lancement…" : "Lancer la partie"}</button>
          : <small>En attente de l'hôte…</small>}
      </>}
      {game.status === "playing" && <small>{game.mySymbol ? `Tu joues ${game.mySymbol}` : "Tu regardes la partie en spectateur"}</small>}
      {game.status === "gameover" && (isHost
        ? <button className="primaryButton" disabled={busy} onClick={() => void action("tttReset")}>Nouvelle partie</button>
        : <small>En attente de l'hôte pour rejouer…</small>)}
    </div>
    {error && <div className="errorBox tttError">{error}<button onClick={() => void refresh()}>↻</button></div>}
  </section>;
}
