"use client";

import { PointerEvent, useEffect, useMemo, useRef, useState } from "react";

type User = { id: string; username: string };
type RoomMember = { id: string; username: string; online: boolean; joined_at: string };
type Room = { code: string; hostId: string; members: RoomMember[] };
type Side = "blue" | "red";
type MatchPlayer = { userId: string; username: string; side: Side };
type Disc = { id: string; side: Side; x: number; y: number };
type Ball = { x: number; y: number };
type Possession = { discId: string; side: Side } | null;
type Game = {
  status: "lobby" | "playing" | "gameover";
  mode: 1 | 2;
  players: MatchPlayer[];
  discs: Disc[];
  ball: Ball;
  turnSide: Side;
  movesLeft: number;
  possession: Possession;
  blueScore: number;
  redScore: number;
  targetScore: number;
  winnerSide: Side | null;
  actionSeq: number;
};
type DragState = { pointerId: number; discId: string; startX: number; startY: number; aim: number; power: number };

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

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

function sideLabel(side: Side) {
  return side === "blue" ? "BLEUS" : "ROUGES";
}

export default function FootballGame({ room, user }: { room: Room; user: User }) {
  const [game, setGame] = useState<Game | null>(null);
  const [mode, setMode] = useState<1 | 2>(1);
  const [targetScore, setTargetScore] = useState(3);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [drag, setDrag] = useState<DragState | null>(null);
  const fieldRef = useRef<HTMLDivElement | null>(null);

  const isHost = room.hostId === user.id;
  const online = useMemo(() => room.members.filter((member) => member.online), [room.members]);
  const mySide = game?.players.find((player) => player.userId === user.id)?.side ?? null;
  const canAct = game?.status === "playing" && mySide === game.turnSide && !busy;
  const blueNames = game?.players.filter((player) => player.side === "blue").map((player) => player.username) ?? [];
  const redNames = game?.players.filter((player) => player.side === "red").map((player) => player.username) ?? [];

  useEffect(() => {
    let alive = true;
    let timer: number | undefined;
    const poll = async () => {
      if (!alive) return;
      try {
        const data = await post({ action: "state", code: room.code });
        if (alive) {
          setGame(data.game as Game);
          setError("");
        }
      } catch (pollError) {
        if (alive && !game) setError(pollError instanceof Error ? pollError.message : "Foot indisponible.");
      }
      if (alive) timer = window.setTimeout(() => void poll(), game?.status === "playing" ? 360 : 1050);
    };
    void poll();
    return () => { alive = false; if (timer !== undefined) window.clearTimeout(timer); };
  }, [room.code, game?.status]);

  async function start() {
    if (!isHost || busy) return;
    setBusy(true);
    setError("");
    try {
      const data = await post({ action: "start", code: room.code, mode, targetScore });
      setGame(data.game as Game);
    } catch (startError) {
      setError(startError instanceof Error ? startError.message : "Impossible de lancer la partie.");
    } finally {
      setBusy(false);
    }
  }

  async function shoot(discId: string, aim: number, power: number) {
    if (!canAct || busy) return;
    setBusy(true);
    setError("");
    try {
      const data = await post({ action: "shot", code: room.code, discId, aim, power });
      setGame(data.game as Game);
    } catch (shotError) {
      setError(shotError instanceof Error ? shotError.message : "Tir impossible.");
    } finally {
      setBusy(false);
    }
  }

  function pointerDown(event: PointerEvent<HTMLButtonElement>, disc: Disc) {
    if (!canAct || disc.side !== game?.turnSide) return;
    if (game?.possession && game.possession.discId !== disc.id) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setDrag({ pointerId: event.pointerId, discId: disc.id, startX: event.clientX, startY: event.clientY, aim: 0, power: 0 });
  }

  function pointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const dy = Math.max(0, event.clientY - drag.startY);
    const dx = event.clientX - drag.startX;
    setDrag({ ...drag, aim: clamp(dx / 115, -1, 1), power: clamp(dy / 145, 0, 1) });
  }

  function finishDrag(event: PointerEvent<HTMLDivElement>) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const shot = drag;
    setDrag(null);
    if (shot.power < 0.12) return;
    void shoot(shot.discId, shot.aim, Math.max(0.15, shot.power));
  }

  if (!game) {
    return <section className="footballGame"><div className="footballLoading">Chargement du terrain…</div>{error && <div className="errorBox">{error}</div>}</section>;
  }

  if (game.status === "lobby") {
    const needed = mode * 2;
    return <section className="footballGame">
      <div className="footballLobby">
        <div>
          <span className="kicker">⚽ FOOT TACTIQUE</span>
          <h2>Foot à pions</h2>
          <p>5 pions par équipe. Tire vers le bas, vise à gauche ou à droite, percute les autres joueurs et marque avec la balle.</p>
        </div>
        <div className="footballRules">
          <span>2 coups par tour</span><span>Collisions alliées + adverses</span><span>Balle collée = retir obligatoire</span>
        </div>
        {isHost ? <div className="footballSetup">
          <div className="footballChoiceRow">
            <button className={mode === 1 ? "active" : ""} onClick={() => setMode(1)}>1v1</button>
            <button className={mode === 2 ? "active" : ""} onClick={() => setMode(2)}>2v2</button>
          </div>
          <label>Premier à
            <select value={targetScore} onChange={(event) => setTargetScore(Number(event.target.value))}>
              {[1, 3, 5, 7, 9].map((score) => <option key={score} value={score}>{score} but{score > 1 ? "s" : ""}</option>)}
            </select>
          </label>
          <button className="footballStart" disabled={busy || online.length < needed} onClick={() => void start()}>{busy ? "Lancement…" : `Lancer le ${mode}v${mode}`}</button>
          <small>{online.length}/{needed} joueurs nécessaires en ligne.</small>
        </div> : <div className="footballWaiting">L'hôte choisit le mode et lance la partie.</div>}
        {error && <div className="errorBox">{error}</div>}
      </div>
    </section>;
  }

  const selectedDisc = drag ? game.discs.find((disc) => disc.id === drag.discId) ?? null : null;
  const directionY = game.turnSide === "blue" ? -1 : 1;
  const previewAngle = drag ? Math.atan2(directionY, drag.aim * 0.86) * 180 / Math.PI : 0;
  const previewLength = drag ? 44 + drag.power * 95 : 0;
  const possessionDisc = game.possession ? game.discs.find((disc) => disc.id === game.possession?.discId) ?? null : null;

  return <section className="footballGame">
    <div className="footballScoreboard">
      <div className="footballTeam blue"><strong>{blueNames.join(" + ") || "Bleus"}</strong><span>{game.blueScore}</span></div>
      <div className="footballMiddle">
        <b>{game.status === "gameover" ? "TERMINÉ" : `${sideLabel(game.turnSide)} · ${game.movesLeft} coup${game.movesLeft > 1 ? "s" : ""}`}</b>
        <small>Premier à {game.targetScore}</small>
      </div>
      <div className="footballTeam red"><span>{game.redScore}</span><strong>{redNames.join(" + ") || "Rouges"}</strong></div>
    </div>

    {game.possession && game.status === "playing" && <div className="footballPossession">⚡ BALLE COLLÉE — retire obligatoirement avec ce pion. Seule la balle partira.</div>}
    {!game.possession && game.status === "playing" && <div className="footballInstruction">{canAct ? "Choisis un pion, tire vers le bas puis décale à gauche/droite pour viser." : mySide ? `Tour des ${sideLabel(game.turnSide).toLowerCase()}.` : "Tu regardes cette partie."}</div>}

    <div
      ref={fieldRef}
      className={`footballField ${canAct ? "canAct" : ""}`}
      onPointerMove={pointerMove}
      onPointerUp={finishDrag}
      onPointerCancel={finishDrag}
    >
      <div className="footballGoal top"/><div className="footballGoal bottom"/>
      <div className="footballHalfLine"/><div className="footballCenterCircle"/><div className="footballBox top"/><div className="footballBox bottom"/>

      {game.discs.map((disc, index) => {
        const selectable = canAct && disc.side === game.turnSide && (!game.possession || game.possession.discId === disc.id);
        const possessed = game.possession?.discId === disc.id;
        return <button
          type="button"
          key={disc.id}
          className={`footballDisc ${disc.side} ${selectable ? "selectable" : ""} ${possessed ? "possessed" : ""}`}
          style={{ left: `${disc.x * 100}%`, top: `${disc.y * 100}%` }}
          onPointerDown={(event) => pointerDown(event, disc)}
          aria-label={`Pion ${disc.side} ${index % 5 + 1}`}
        >{index % 5 + 1}</button>;
      })}

      <div className={`footballBall ${game.possession ? "attached" : ""}`} style={{ left: `${game.ball.x * 100}%`, top: `${game.ball.y * 100}%` }}>⚽</div>

      {drag && selectedDisc && <>
        <div className="footballAimLine" style={{ left: `${selectedDisc.x * 100}%`, top: `${selectedDisc.y * 100}%`, width: `${previewLength}px`, transform: `rotate(${previewAngle}deg)` }}/>
        <div className="footballPower"><span style={{ width: `${Math.round(drag.power * 100)}%` }}/></div>
      </>}

      {game.status === "gameover" && <div className="footballGameover">
        <span>🏆</span><strong>{game.winnerSide ? `${sideLabel(game.winnerSide)} GAGNENT` : "TERMINÉ"}</strong>
        <small>{game.blueScore} - {game.redScore}</small>
        {isHost && <button disabled={busy} onClick={() => void start()}>↻ Rejouer</button>}
      </div>}
      {busy && game.status === "playing" && <div className="footballBusy">Calcul du coup…</div>}
    </div>
    {error && <div className="errorBox">{error}</div>}
  </section>;
}
