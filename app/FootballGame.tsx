"use client";

import { PointerEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  footballAimForVector,
  footballDirection,
  simulateFootballShot,
  type FootballBall,
  type FootballDisc,
  type FootballSide,
} from "@/lib/football-physics";

type User = { id: string; username: string };
type RoomMember = { id: string; username: string; online: boolean; joined_at: string };
type Room = { code: string; hostId: string; members: RoomMember[] };
type MatchPlayer = { userId: string; username: string; side: FootballSide; isBot?: boolean };
type Game = {
  status: "lobby" | "playing" | "gameover";
  mode: 1 | 2;
  players: MatchPlayer[];
  discs: FootballDisc[];
  ball: FootballBall;
  turnSide: FootballSide;
  movesLeft: number;
  blueScore: number;
  redScore: number;
  targetScore: number;
  winnerSide: FootballSide | null;
  actionSeq: number;
};
type DragState = {
  pointerId: number;
  discId: string;
  startX: number;
  startY: number;
  aim: number;
  power: number;
};

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const sideLabel = (side: FootballSide) => side === "blue" ? "BLEUS" : "ROUGES";

async function post(payload: Record<string, unknown>) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 6500);
  try {
    const response = await fetch("/api/football", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      cache: "no-store",
      signal: controller.signal,
    });
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.error || "Erreur Foot.");
    return data;
  } finally {
    window.clearTimeout(timeout);
  }
}

export default function FootballGame({ room, user }: { room: Room; user: User }) {
  const [game, setGame] = useState<Game | null>(null);
  const [mode, setMode] = useState<1 | 2>(1);
  const [targetScore, setTargetScore] = useState(3);
  const [fillBots, setFillBots] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [drag, setDrag] = useState<DragState | null>(null);

  const fieldRef = useRef<HTMLDivElement | null>(null);
  const gameRef = useRef<Game | null>(null);
  const actionBusyRef = useRef(false);
  const botBusyRef = useRef(false);

  const isHost = room.hostId === user.id;
  const online = useMemo(() => room.members.filter((member) => member.online), [room.members]);
  const mySide = game?.players.find((player) => player.userId === user.id && !player.isBot)?.side ?? null;
  const canAct = game?.status === "playing" && mySide === game.turnSide && !busy;
  const blueNames = game?.players.filter((player) => player.side === "blue").map((player) => player.username) ?? [];
  const redNames = game?.players.filter((player) => player.side === "red").map((player) => player.username) ?? [];

  useEffect(() => { gameRef.current = game; }, [game]);

  useEffect(() => {
    let alive = true;
    let timer: number | undefined;
    const poll = async () => {
      if (!alive) return;
      if (!actionBusyRef.current) {
        try {
          const data = await post({ action: "state", code: room.code });
          if (alive && !actionBusyRef.current) { setGame(data.game as Game); setError(""); }
        } catch (pollError) {
          if (alive && !gameRef.current) setError(pollError instanceof Error ? pollError.message : "Foot indisponible.");
        }
      }
      if (alive) timer = window.setTimeout(() => void poll(), gameRef.current?.status === "playing" ? 300 : 900);
    };
    void poll();
    return () => { alive = false; if (timer !== undefined) window.clearTimeout(timer); };
  }, [room.code]);

  useEffect(() => {
    if (!isHost || game?.status !== "playing") return;
    const sidePlayers = game.players.filter((player) => player.side === game.turnSide);
    if (!sidePlayers.length || sidePlayers.some((player) => !player.isBot)) return;
    const id = window.setTimeout(async () => {
      if (botBusyRef.current || actionBusyRef.current) return;
      botBusyRef.current = true;
      try {
        const data = await post({ action: "botTick", code: room.code });
        if (data.game) setGame(data.game as Game);
      } catch {} finally {
        botBusyRef.current = false;
      }
    }, 360);
    return () => window.clearTimeout(id);
  }, [game?.actionSeq, game?.status, game?.turnSide, isHost, room.code]);

  async function start() {
    if (!isHost || busy) return;
    setBusy(true); setError(""); setDrag(null); actionBusyRef.current = true;
    try {
      const data = await post({ action: "start", code: room.code, mode, targetScore, fillBots });
      setGame(data.game as Game);
    } catch (startError) {
      setError(startError instanceof Error ? startError.message : "Impossible de lancer la partie.");
    } finally {
      actionBusyRef.current = false;
      setBusy(false);
    }
  }

  async function shoot(discId: string, aim: number, power: number) {
    const current = gameRef.current;
    if (!current || current.status !== "playing" || !mySide || current.turnSide !== mySide || actionBusyRef.current) return;

    actionBusyRef.current = true;
    setBusy(true); setError("");
    try {
      const preview = simulateFootballShot(current.discs, current.ball, discId, mySide, aim, power);
      const optimistic: Game = { ...current, discs: preview.discs, ball: preview.ball };
      gameRef.current = optimistic;
      setGame(optimistic);

      const data = await post({ action: "shot", code: room.code, discId, aim, power });
      gameRef.current = data.game as Game;
      setGame(data.game as Game);
    } catch (shotError) {
      setError(shotError instanceof Error ? shotError.message : "Tir impossible.");
      try {
        const data = await post({ action: "state", code: room.code });
        gameRef.current = data.game as Game;
        setGame(data.game as Game);
      } catch {}
    } finally {
      actionBusyRef.current = false;
      setBusy(false);
    }
  }

  function calculateDrag(current: DragState, clientX: number, clientY: number) {
    const rect = fieldRef.current?.getBoundingClientRect();
    const side = gameRef.current?.turnSide;
    if (!rect || !side) return current;

    const pullX = current.startX - clientX;
    const pullY = current.startY - clientY;
    const normalizedX = pullX / Math.max(1, rect.width);
    const normalizedY = pullY / Math.max(1, rect.height);
    const aim = footballAimForVector(side, normalizedX, normalizedY);
    const distancePx = Math.hypot(pullX, pullY);
    const chargeDistance = Math.max(90, Math.min(rect.width, rect.height) * 0.48);
    const power = clamp(distancePx / chargeDistance, 0, 1);
    return { ...current, aim, power };
  }

  function pointerDown(event: PointerEvent<HTMLButtonElement>, disc: FootballDisc) {
    if (!canAct || disc.side !== game?.turnSide) return;
    event.preventDefault();
    event.stopPropagation();
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch {}
    setDrag({ pointerId: event.pointerId, discId: disc.id, startX: event.clientX, startY: event.clientY, aim: 0, power: 0 });
  }

  function pointerMove(event: PointerEvent<HTMLButtonElement>) {
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    const next = calculateDrag(drag, event.clientX, event.clientY);
    setDrag(next);
  }

  function pointerUp(event: PointerEvent<HTMLButtonElement>) {
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    const shot = calculateDrag(drag, event.clientX, event.clientY);
    setDrag(null);
    try { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); } catch {}
    if (shot.power < 0.08) return;
    void shoot(shot.discId, shot.aim, Math.max(0.10, shot.power));
  }

  if (!game) {
    return <section className="footballGame"><div className="footballLoading">Chargement du terrain…</div>{error && <div className="errorBox">{error}</div>}</section>;
  }

  if (game.status === "lobby") {
    const needed = mode * 2;
    return <section className="footballGame"><div className="footballLobby">
      <div><span className="kicker">⚽ FOOT ARCADE</span><h2>Foot à pions</h2><p>Choisis un pion, tire ton doigt dans la direction opposée au tir et relâche. Tu peux maintenant viser à 360°, même si ton doigt sort complètement du terrain.</p></div>
      <div className="footballRules"><span>Visée 360°</span><span>2 tirs par équipe</span><span>Collisions libres</span><span>1v1 ou 2v2 + bots</span></div>
      {isHost ? <div className="footballSetup">
        <div className="footballChoiceRow"><button className={mode === 1 ? "active" : ""} onClick={() => setMode(1)}>1v1</button><button className={mode === 2 ? "active" : ""} onClick={() => setMode(2)}>2v2</button></div>
        <label>Premier à<select value={targetScore} onChange={(event) => setTargetScore(Number(event.target.value))}>{[1,3,5,7,9].map((score) => <option key={score} value={score}>{score} but{score > 1 ? "s" : ""}</option>)}</select></label>
        <label className="footballBotToggle"><input type="checkbox" checked={fillBots} onChange={(event) => setFillBots(event.target.checked)}/><span>🤖 Compléter avec des bots</span></label>
        <button className="footballStart" disabled={busy || (!fillBots && online.length < needed)} onClick={() => void start()}>{busy ? "Lancement…" : `Lancer le ${mode}v${mode}`}</button>
        <small>{online.length}/{needed} joueur{needed > 1 ? "s" : ""} en ligne · {fillBots ? "les places manquantes seront remplies par des bots" : "bots désactivés"}.</small>
      </div> : <div className="footballWaiting">L'hôte choisit le mode et lance la partie.</div>}
      {error && <div className="errorBox">{error}</div>}
    </div></section>;
  }

  const selectedDisc = drag ? game.discs.find((disc) => disc.id === drag.discId) ?? null : null;
  const direction = drag ? footballDirection(game.turnSide, drag.aim) : { x: 0, y: 0 };
  const fieldRect = fieldRef.current?.getBoundingClientRect();
  const previewAngle = drag && fieldRect ? Math.atan2(direction.y * fieldRect.height, direction.x * fieldRect.width) * 180 / Math.PI : 0;
  const previewLength = drag ? 58 + drag.power * 160 : 0;

  return <section className="footballGame">
    <div className="footballScoreboard">
      <div className="footballTeam blue"><strong>{blueNames.join(" + ") || "Bleus"}</strong><span>{game.blueScore}</span></div>
      <div className="footballMiddle"><b>{game.status === "gameover" ? "TERMINÉ" : `${sideLabel(game.turnSide)} · ${game.movesLeft} tir${game.movesLeft > 1 ? "s" : ""}`}</b><small>Premier à {game.targetScore}</small></div>
      <div className="footballTeam red"><span>{game.redScore}</span><strong>{redNames.join(" + ") || "Rouges"}</strong></div>
    </div>

    {game.status === "playing" && <div className="footballInstruction">{canAct ? "Maintiens un pion puis tire ton doigt n'importe où autour de lui. La flèche continue même hors du terrain." : mySide ? `Tour des ${sideLabel(game.turnSide).toLowerCase()}.` : "Tu regardes cette partie."}</div>}

    <div ref={fieldRef} className={`footballField ${canAct ? "canAct" : ""}`}>
      <div className="footballGoal top"/><div className="footballGoal bottom"/><div className="footballHalfLine"/><div className="footballCenterCircle"/><div className="footballBox top"/><div className="footballBox bottom"/>
      {game.discs.map((disc, index) => {
        const selectable = canAct && disc.side === game.turnSide;
        return <button
          type="button"
          key={disc.id}
          className={`footballDisc ${disc.side} ${selectable ? "selectable" : ""}`}
          style={{ left: `${disc.x * 100}%`, top: `${disc.y * 100}%` }}
          onPointerDown={(event) => pointerDown(event, disc)}
          onPointerMove={pointerMove}
          onPointerUp={pointerUp}
          onPointerCancel={pointerUp}
          aria-label={`Pion ${disc.side} ${index % 5 + 1}`}
        >{index % 5 + 1}</button>;
      })}
      <div className="footballBall" style={{ left: `${game.ball.x * 100}%`, top: `${game.ball.y * 100}%` }}>⚽</div>
      {drag && selectedDisc && <>
        <div className="footballAimLine" style={{ left: `${selectedDisc.x * 100}%`, top: `${selectedDisc.y * 100}%`, width: `${previewLength}px`, transform: `rotate(${previewAngle}deg)` }}/>
        <div className="footballPower"><span style={{ width: `${Math.round(drag.power * 100)}%` }}/></div>
      </>}
      {game.status === "gameover" && <div className="footballGameover"><span>🏆</span><strong>{game.winnerSide ? `${sideLabel(game.winnerSide)} GAGNENT` : "TERMINÉ"}</strong><small>{game.blueScore} - {game.redScore}</small>{isHost && <button disabled={busy} onClick={() => void start()}>↻ Rejouer</button>}</div>}
      {busy && game.status === "playing" && <div className="footballBusy">Tir…</div>}
    </div>
    {error && <div className="errorBox">{error}</div>}
  </section>;
}
