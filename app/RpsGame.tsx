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
const SUBTITLES: Record<Choice, string> = { rock: "Écrase les ciseaux", paper: "Recouvre la pierre", scissors: "Coupe la feuille" };

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
    const id = window.setInterval(() => setClock(Date.now()), 70);
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
    const id = window.setInterval(poll, game?.status === "playing" ? 160 : 600);
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
  const currentRound = game ? Math.min(game.roundIndex + (game.phase === "reveal" || game.status === "gameover" ? 0 : 1), game.roundsTotal) : 1;

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
    if (busy || game?.phase !== "choosing" || game.myChoice) return;
    const before = game;
    setGame({ ...game, myChoice: choice });
    try {
      setBusy(true); setError("");
      const data = await post({ action: "choose", code: room.code, choice });
      setGame(data.game as Game);
    } catch (actionError) {
      setGame(before);
      setError(actionError instanceof Error ? actionError.message : "Impossible d'enregistrer ton choix.");
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
    return <section className="rpsLobby rpsLobbyV2">
      <div className="rpsLobbyMark"><div><span>✊</span><span>✋</span><span>✌️</span></div></div>
      <div className="rpsLobbyCopy">
        <span className="kicker">DUEL · 2 JOUEURS</span>
        <h2>Pierre · Feuille · Ciseaux</h2>
        <p>Choisis en secret. Au bout de 3 secondes : Pierre, Feuille, Ciseaux… révélation.</p>
        <div className="rpsRoundPicker">
          <small>NOMBRE DE MANCHES</small>
          <div>{[1,3,5,7,10,15].map((rounds) => <button key={rounds} className={game.roundsTotal === rounds ? "selected" : ""} disabled={!isHost || busy} onClick={() => void configure(rounds)}>{rounds}</button>)}</div>
        </div>
      </div>
      <div className="rpsReady">
        <div className="rpsOnline"><i className={online === 2 ? "ready" : ""}/><span>{online}/2 connectés</span></div>
        {isHost ? <button className="primaryButton" disabled={busy || online !== 2} onClick={() => void start()}>{busy ? "Lancement…" : "Lancer le duel"}</button> : <small>En attente de l'hôte…</small>}
      </div>
      {error && <div className="errorBox rpsLobbyError">{error}</div>}
    </section>;
  }

  const result = game.lastResult;
  const winnerName = game.winnerSide === "left" ? left?.username : game.winnerSide === "right" ? right?.username : null;

  return <section className="rpsGameWrap rpsGameV2">
    <div className="rpsScoreBar rpsScoreV2">
      <div className="rpsPlayerScore left"><span className="rpsAvatar">{left?.username.slice(0,1).toUpperCase() ?? "1"}</span><div><small>{left?.username ?? "Joueur 1"}</small><strong>{game.leftScore}</strong></div></div>
      <div className="rpsRoundBadge"><small>MANCHE</small><strong>{currentRound}<i>/</i>{game.roundsTotal}</strong></div>
      <div className="rpsPlayerScore right"><div><small>{right?.username ?? "Joueur 2"}</small><strong>{game.rightScore}</strong></div><span className="rpsAvatar">{right?.username.slice(0,1).toUpperCase() ?? "2"}</span></div>
    </div>

    <div className="rpsArena rpsArenaV2">
      <div className="rpsArenaGlow one"/><div className="rpsArenaGlow two"/>

      {game.status === "playing" && game.phase === "choosing" && <div className="rpsChooseStage">
        <div className="rpsChooseHead">
          <div className={`rpsTimerOrb ${seconds <= 1 ? "urgent" : ""}`}><strong>{seconds}</strong><span>s</span></div>
          <div><small>À TOI DE JOUER</small><h2>{game.myChoice ? "Choix enregistré" : "Choisis ton coup"}</h2><p>{game.myChoice ? "Ton adversaire ne peut pas le voir." : "Tu as 3 secondes. Ton choix reste secret jusqu'à la révélation."}</p></div>
        </div>

        {me ? <div className="rpsChoices rpsChoicesV2">
          {(["rock","paper","scissors"] as Choice[]).map((choice) => {
            const selected = game.myChoice === choice;
            return <button key={choice} className={selected ? "chosen" : ""} disabled={busy || Boolean(game.myChoice)} onClick={() => void choose(choice)}>
              <span className="rpsChoiceIcon">{ICONS[choice]}</span>
              <strong>{LABELS[choice]}</strong>
              <small>{SUBTITLES[choice]}</small>
              {selected && <b>✓</b>}
            </button>;
          })}
        </div> : <div className="rpsSpectator">Tu regardes le duel.</div>}

        {game.myChoice && <div className="rpsLocked"><span>{ICONS[game.myChoice]}</span><div><small>TON CHOIX</small><strong>{LABELS[game.myChoice]}</strong></div></div>}
      </div>}

      {game.status === "playing" && game.phase === "chant" && <div className="rpsChantStage"><small>PRÊTS ?</small><div className="rpsChant" key={chant}>{chant}</div><div className="rpsChantDots"><i/><i/><i/></div></div>}

      {(game.phase === "reveal" || game.status === "gameover") && result && <div className="rpsReveal rpsRevealV2">
        <div className={`rpsRevealSide ${result.winnerSide === "left" ? "roundWinner" : ""}`}><small>{left?.username}</small><span>{ICONS[result.leftChoice]}</span><strong>{LABELS[result.leftChoice]}</strong></div>
        <div className="rpsVersus"><span>VS</span></div>
        <div className={`rpsRevealSide ${result.winnerSide === "right" ? "roundWinner" : ""}`}><small>{right?.username}</small><span>{ICONS[result.rightChoice]}</span><strong>{LABELS[result.rightChoice]}</strong></div>
        <p>{result.winnerSide === null ? "ÉGALITÉ !" : `${result.winnerSide === "left" ? left?.username : right?.username} remporte la manche`}</p>
      </div>}

      {game.status === "gameover" && <div className="rpsGameOver rpsGameOverV2">
        <span className="rpsTrophy">🏆</span>
        <small>DUEL TERMINÉ</small>
        <h2>{winnerName ? `${winnerName} gagne !` : "Match nul !"}</h2>
        <div className="rpsFinalScore"><b>{game.leftScore}</b><span>—</span><b>{game.rightScore}</b></div>
        {isHost && <button className="primaryButton" disabled={busy} onClick={() => void stop()}>Retour aux jeux</button>}
      </div>}
    </div>
    {error && <div className="errorBox rpsGameError">{error}</div>}
  </section>;
}
