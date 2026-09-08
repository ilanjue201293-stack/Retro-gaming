"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type User = { id: string; username: string };
type RoomMember = { id: string; username: string; online: boolean; joined_at: string };
type Room = { code: string; hostId: string; members: RoomMember[] };
type Side = "left" | "right";
type Choice = "rock" | "paper" | "scissors";
type Player = { userId: string; username: string; side: Side };
type Result = { leftChoice: Choice; rightChoice: Choice; winnerSide: Side | null };
type Game = {
  status: "lobby" | "playing" | "gameover";
  players: Player[];
  roundsTotal: number;
  roundIndex: number;
  leftScore: number;
  rightScore: number;
  phase: "choosing" | "chant" | "reveal" | "gameover";
  phaseStartedAt: number | null;
  phaseEndsAt: number | null;
  myChoice: Choice | null;
  lastResult: Result | null;
  winnerSide: Side | null;
};

const LABELS: Record<Choice, string> = { rock: "PIERRE", paper: "FEUILLE", scissors: "CISEAUX" };
const ICONS: Record<Choice, string> = { rock: "✊", paper: "✋", scissors: "✌️" };

async function post(payload: Record<string, unknown>) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 4500);
  try {
    const response = await fetch("/api/rps", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      cache: "no-store",
      signal: controller.signal,
    });
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.error || "Pierre-Feuille-Ciseaux indisponible.");
    return data;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw new Error("Le jeu met trop de temps à répondre.");
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}

export default function RpsGame({ room, user }: { room: Room; user: User }) {
  const [game, setGame] = useState<Game | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [clock, setClock] = useState(Date.now());
  const gameRef = useRef<Game | null>(null);

  useEffect(() => { gameRef.current = game; }, [game]);
  useEffect(() => {
    const id = window.setInterval(() => setClock(Date.now()), 80);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    let alive = true;
    let inFlight = false;
    const poll = async () => {
      if (!alive || inFlight) return;
      inFlight = true;
      try {
        const data = await post({ action: "state", code: room.code });
        if (alive) {
          setGame(data.game as Game);
          setError("");
        }
      } catch (pollError) {
        if (alive) setError(pollError instanceof Error ? pollError.message : "Jeu indisponible.");
      } finally {
        inFlight = false;
      }
    };
    void poll();
    const id = window.setInterval(poll, game?.status === "playing" ? 180 : 600);
    return () => { alive = false; window.clearInterval(id); };
  }, [room.code, game?.status]);

  useEffect(() => {
    const active = game?.status === "playing" || game?.status === "gameover";
    document.body.classList.toggle("rps-match-active", Boolean(active));
    return () => document.body.classList.remove("rps-match-active");
  }, [game?.status]);

  const isHost = room.hostId === user.id;
  const online = room.members.filter((member) => member.online).length;
  const left = game?.players.find((player) => player.side === "left") ?? null;
  const right = game?.players.find((player) => player.side === "right") ?? null;
  const me = game?.players.find((player) => player.userId === user.id) ?? null;
  const seconds = game?.phaseEndsAt ? Math.max(0, Math.ceil((game.phaseEndsAt - clock) / 1000)) : 0;

  const chant = useMemo(() => {
    if (!game || game.phase !== "chant" || !game.phaseStartedAt) return "";
    const elapsed = Math.max(0, clock - game.phaseStartedAt);
    if (elapsed < 700) return "PIERRE";
    if (elapsed < 1400) return "FEUILLE";
    return "CISEAUX !!!";
  }, [clock, game]);

  const configure = async (roundsTotal: number) => {
    try {
      setBusy(true); setError("");
      const data = await post({ action: "configure", code: room.code, roundsTotal });
      setGame(data.game as Game);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Erreur.");
    } finally { setBusy(false); }
  };

  const start = async () => {
    try {
      setBusy(true); setError("");
      const data = await post({ action: "start", code: room.code });
      setGame(data.game as Game);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Erreur.");
    } finally { setBusy(false); }
  };

  const choose = async (choice: Choice) => {
    if (busy || game?.phase !== "choosing") return;
    try {
      setBusy(true); setError("");
      const data = await post({ action: "choose", code: room.code, choice });
      setGame(data.game as Game);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Erreur.");
    } finally { setBusy(false); }
  };

  const stop = async () => {
    try {
      setBusy(true); setError("");
      const data = await post({ action: "stop", code: room.code });
      setGame(data.game as Game);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Erreur.");
    } finally { setBusy(false); }
  };

  if (!game) return <section className="rpsLobby"><div className="spinner"/><p>Chargement de Pierre‑Feuille‑Ciseaux…</p>{error && <div className="errorBox">{error}</div>}</section>;

  if (game.status === "lobby") {
    return <section className="rpsLobby">
      <div className="rpsLobbyIcon"><span>✊</span><span>✋</span><span>✌️</span></div>
      <div className="rpsLobbyCopy">
        <span className="kicker">DUEL · 2 JOUEURS</span>
        <h2>Pierre · Feuille · Ciseaux</h2>
        <p>3 secondes pour choisir, puis révélation simultanée.</p>
        <div className="rpsRoundPicker">
          <small>Nombre de manches</small>
          <div>{[1,3,5,7,10,15].map((rounds) => <button key={rounds} className={game.roundsTotal === rounds ? "selected" : ""} disabled={!isHost || busy} onClick={() => void configure(rounds)}>{rounds}</button>)}</div>
        </div>
      </div>
      <div className="rpsReady">
        <span>{online}/2 joueurs connectés</span>
        {isHost ? <button className="primaryButton" disabled={busy || online !== 2} onClick={() => void start()}>{busy ? "Lancement…" : "Lancer le duel"}</button> : <small>En attente de l'hôte…</small>}
      </div>
      {error && <div className="errorBox rpsLobbyError">{error}</div>}
    </section>;
  }

  const result = game.lastResult;
  const winnerName = game.winnerSide === "left" ? left?.username : game.winnerSide === "right" ? right?.username : null;

  return <section className="rpsGameWrap">
    <div className="rpsScoreBar">
      <div><small>{left?.username ?? "Joueur 1"}</small><strong>{game.leftScore}</strong></div>
      <span>Manche {Math.min(game.roundIndex + (game.phase === "reveal" ? 0 : 1), game.roundsTotal)}/{game.roundsTotal}</span>
      <div><strong>{game.rightScore}</strong><small>{right?.username ?? "Joueur 2"}</small></div>
    </div>

    <div className="rpsArena">
      {game.status === "playing" && game.phase === "choosing" && <>
        <div className="rpsCountdown"><strong>{seconds}</strong><small>CHOISIS !</small></div>
        {me ? <div className="rpsChoices">
          {(["rock","paper","scissors"] as Choice[]).map((choice) => <button key={choice} className={game.myChoice === choice ? "chosen" : ""} disabled={busy} onClick={() => void choose(choice)}><span>{ICONS[choice]}</span><strong>{LABELS[choice]}</strong></button>)}
        </div> : <div className="rpsSpectator">Tu regardes le duel.</div>}
        {game.myChoice && <div className="rpsLocked">✓ {LABELS[game.myChoice]} sélectionné</div>}
      </>}

      {game.status === "playing" && game.phase === "chant" && <div className="rpsChant">{chant}</div>}

      {(game.phase === "reveal" || game.status === "gameover") && result && <div className="rpsReveal">
        <div><small>{left?.username}</small><span>{ICONS[result.leftChoice]}</span><strong>{LABELS[result.leftChoice]}</strong></div>
        <b>VS</b>
        <div><small>{right?.username}</small><span>{ICONS[result.rightChoice]}</span><strong>{LABELS[result.rightChoice]}</strong></div>
        <p>{result.winnerSide === null ? "ÉGALITÉ !" : `${result.winnerSide === "left" ? left?.username : right?.username} gagne la manche !`}</p>
      </div>}

      {game.status === "gameover" && <div className="rpsGameOver">
        <span>🏆</span>
        <h2>{winnerName ? `${winnerName} gagne !` : "Match nul !"}</h2>
        <p>{game.leftScore} — {game.rightScore}</p>
        {isHost && <button className="primaryButton" disabled={busy} onClick={() => void stop()}>Retour aux jeux</button>}
      </div>}
    </div>
    {error && <div className="errorBox">{error}</div>}
  </section>;
}
