"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

type RoomMember = { id: string; username: string; online: boolean; joined_at: string };
type Room = { code: string; hostId: string; members: RoomMember[]; userId: string };
type Player = { userId: string; username: string };
type LastAction = { username: string; value: string; kind: "letter" | "word"; correct: boolean };
type Game = {
  status: "lobby" | "playing" | "gameover";
  players: Player[];
  displayWord: string;
  revealedWord: string | null;
  guessedLetters: string[];
  wrongWords: string[];
  errors: number;
  maxErrors: number;
  turnIndex: number;
  currentPlayerId: string | null;
  currentPlayerName: string | null;
  isMyTurn: boolean;
  won: boolean | null;
  lastAction: LastAction | null;
};

const TRY_OPTIONS = [5, 7, 10, 12, 15];
async function post(payload: Record<string, unknown>) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 5500);
  try {
    const response = await fetch("/api/hangman", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload), cache: "no-store", signal: controller.signal });
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.error || "Pendu indisponible.");
    return data;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw new Error("Le Pendu met trop de temps à répondre.");
    throw error;
  } finally { window.clearTimeout(timeout); }
}

export default function HangmanGame({ room }: { room: Room }) {
  const [game, setGame] = useState<Game | null>(null);
  const [wordEntry, setWordEntry] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const isHost = room.hostId === room.userId;

  useEffect(() => {
    let alive = true, inFlight = false, timer = 0;
    const poll = async () => {
      if (!alive || inFlight || document.visibilityState === "hidden") return;
      inFlight = true;
      try { const data = await post({ action: "state", code: room.code }); if (alive) { setGame(data.game as Game); setError(""); } }
      catch (err) { if (alive && !game) setError(err instanceof Error ? err.message : "Pendu indisponible."); }
      finally { inFlight = false; }
    };
    void poll();
    timer = window.setInterval(poll, game?.status === "playing" ? 450 : 1200);
    return () => { alive = false; window.clearInterval(timer); };
  }, [room.code, game?.status]);

  const action = async (name: "start" | "stop" | "configure", extra: Record<string, unknown> = {}) => {
    try { setBusy(true); setError(""); const data = await post({ action: name, code: room.code, ...extra }); setGame(data.game as Game); setWordEntry(""); }
    catch (err) { setError(err instanceof Error ? err.message : "Action impossible."); }
    finally { setBusy(false); }
  };
  const guess = async (proposal: string) => {
    if (!game?.isMyTurn || busy) return;
    try { setBusy(true); setError(""); const data = await post({ action: "guess", code: room.code, proposal }); setGame(data.game as Game); setWordEntry(""); }
    catch (err) { setError(err instanceof Error ? err.message : "Proposition impossible."); }
    finally { setBusy(false); }
  };
  const submitWord = (event: FormEvent) => { event.preventDefault(); if (wordEntry.trim().length >= 2) void guess(wordEntry); };
  const used = useMemo(() => new Set(game?.guessedLetters ?? []), [game?.guessedLetters]);
  const stage = game ? Math.min(7, Math.ceil((game.errors / Math.max(1, game.maxErrors)) * 7)) : 0;

  if (!game) return <section className="miniGameCard hangmanGame"><div className="spinner"/><p>Chargement du Pendu…</p>{error && <div className="errorBox">{error}</div>}</section>;

  if (game.status === "lobby") return <section className="miniGameCard hangmanGame">
    <div className="miniHeroIcon">📝</div><span className="kicker">MOTS · MULTIJOUEUR</span><h2>Le Pendu</h2>
    <p>Le serveur choisit un mot secret. Vous proposez chacun votre tour une lettre ou directement le mot entier.</p>
    <div className="hangmanLobbySetup">
      <div><strong>{room.members.filter((member) => member.online).length} joueur{room.members.filter((member) => member.online).length > 1 ? "s" : ""} connecté{room.members.filter((member) => member.online).length > 1 ? "s" : ""}</strong><small>Jusqu'à 8 joueurs peuvent participer dans la même partie.</small></div>
      <label><span>Nombre d'essais</span><select value={game.maxErrors} disabled={!isHost || busy} onChange={(event) => void action("configure", { maxErrors: Number(event.target.value) })}>{TRY_OPTIONS.map((value) => <option key={value} value={value}>{value} erreurs</option>)}</select></label>
      {isHost ? <button className="primaryButton" disabled={busy} onClick={() => void action("start")}>{busy ? "Lancement…" : "Lancer le Pendu"}</button> : <small>En attente de l'hôte…</small>}
    </div>{error && <div className="errorBox">{error}</div>}
  </section>;

  return <section className="miniGameCard hangmanGame hangmanMulti">
    <div className="miniGameTop"><div><span className="kicker">LE PENDU · TOUR PAR TOUR</span><h2>{game.status === "gameover" ? (game.won ? "Mot trouvé !" : "Mot perdu !") : game.isMyTurn ? "À toi de jouer" : `Tour de ${game.currentPlayerName ?? "…"}`}</h2></div><div className="miniStat"><small>ERREURS</small><strong>{game.errors}/{game.maxErrors}</strong></div></div>
    <div className="hangmanPlayers">{game.players.map((player, index) => <span key={player.userId} className={game.status === "playing" && index === game.turnIndex ? "turn" : ""}>{index === game.turnIndex && game.status === "playing" ? "▶ " : ""}{player.username}{player.userId === room.userId ? " (toi)" : ""}</span>)}</div>
    <div className="hangmanStage"><div className={`hangmanFigure errors-${stage}`}><i className="rope"/><i className="head"/><i className="body"/><i className="arm left"/><i className="arm right"/><i className="leg left"/><i className="leg right"/></div><div><div className="hangmanWord">{game.displayWord}</div>{game.status === "gameover" && <div className="hangmanReveal">Mot : <strong>{game.revealedWord}</strong></div>}</div></div>
    {game.lastAction && <div className={`hangmanLastAction ${game.lastAction.correct ? "correct" : "wrong"}`}>{game.lastAction.username} a proposé <strong>{game.lastAction.value}</strong> · {game.lastAction.correct ? "bon !" : "raté"}</div>}
    {game.status === "playing" && <>
      <div className="letterGrid">{"ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").map((letter) => <button key={letter} disabled={busy || !game.isMyTurn || used.has(letter)} onClick={() => void guess(letter)}>{letter}</button>)}</div>
      <form className="hangmanWordGuess" onSubmit={submitWord}><input value={wordEntry} disabled={!game.isMyTurn || busy} maxLength={40} onChange={(event) => setWordEntry(event.target.value)} placeholder={game.isMyTurn ? "Tu penses avoir trouvé ? Écris le mot entier" : `Attends le tour de ${game.currentPlayerName ?? "l'autre joueur"}`}/><button className="primaryButton" disabled={!game.isMyTurn || busy || wordEntry.trim().length < 2}>Proposer le mot</button></form>
      {!!game.wrongWords.length && <div className="hangmanWrongWords"><small>MOTS RATÉS</small>{game.wrongWords.map((word) => <span key={word}>{word}</span>)}</div>}
    </>}
    {game.status === "gameover" && (isHost ? <div className="miniGameActions"><button className="primaryButton" disabled={busy} onClick={() => void action("start")}>↻ Rejouer</button><button className="secondaryButton" disabled={busy} onClick={() => void action("stop")}>Lobby du jeu</button></div> : <small>En attente de l'hôte pour rejouer…</small>)}
    {error && <div className="errorBox">{error}</div>}
  </section>;
}
