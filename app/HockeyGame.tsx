"use client";

import { PointerEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

type User = { id: string; username: string };
type RoomMember = { id: string; username: string; online: boolean; joined_at: string };
type Room = { code: string; hostId: string; members: RoomMember[] };
type Mode = "1v1" | "2v2";
type Side = "left" | "right";
type Player = { userId: string; username: string; side: Side; slot: number };
type Paddle = { x: number; y: number; vx: number; vy: number };
type Frame = {
  puck: { x: number; y: number; vx: number; vy: number };
  paddles: Record<string, Paddle>;
  leftScore: number;
  rightScore: number;
  winnerSide: Side | null;
  pauseUntil: number;
};
type Game = {
  mode: Mode;
  status: "lobby" | "playing" | "gameover";
  players: Player[];
  leftScore: number;
  rightScore: number;
  winnerSide: Side | null;
  targetScore: number;
  frame: Frame | null;
};
type LocalInput = { x: number; y: number; vx: number; vy: number };

const MAX_MALLET = 1.25;

async function post(payload: Record<string, unknown>) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 6500);
  try {
    const res = await fetch("/api/hockey", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      cache: "no-store",
      signal: controller.signal,
    });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || "Erreur.");
    return data;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("Le serveur hockey met trop de temps à répondre.");
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}

function initial(player: Player, mode: Mode): Paddle {
  return {
    x: player.side === "left" ? 0.2 : 0.8,
    y: mode === "1v1" ? 0.5 : player.slot === 0 ? 0.34 : 0.66,
    vx: 0,
    vy: 0,
  };
}

function clampPad(side: Side, x: number, y: number) {
  return {
    x: Math.max(side === "left" ? 0.075 : 0.53, Math.min(side === "left" ? 0.47 : 0.925, x)),
    y: Math.max(0.085, Math.min(0.915, y)),
  };
}

export default function HockeyGame({ room, user, onActiveChange }: { room: Room; user: User; onActiveChange?: (active: boolean) => void }) {
  const [game, setGame] = useState<Game | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [localPad, setLocalPad] = useState<{ x: number; y: number } | null>(null);
  const rinkRef = useRef<HTMLDivElement | null>(null);
  const gameRef = useRef<Game | null>(null);
  const inputRef = useRef<LocalInput | null>(null);
  const lastInputRef = useRef({ x: 0.5, y: 0.5, at: Date.now() });

  useEffect(() => { gameRef.current = game; }, [game]);

  const me = useMemo(() => game?.players.find((player) => player.userId === user.id) ?? null, [game, user.id]);
  const left = useMemo(() => game?.players.filter((player) => player.side === "left") ?? [], [game]);
  const right = useMemo(() => game?.players.filter((player) => player.side === "right") ?? [], [game]);
  const isHost = room.hostId === user.id;
  const needed = game?.mode === "2v2" ? 4 : 2;
  const online = room.members.filter((member) => member.online).length;

  const apply = useCallback((next: Game) => {
    gameRef.current = next;
    setGame(next);
    setError("");
  }, []);

  useEffect(() => {
    let alive = true;
    let waiting = false;

    const sync = async () => {
      if (!alive || waiting) return;
      waiting = true;
      try {
        const current = gameRef.current;
        const player = current?.players.find((entry) => entry.userId === user.id);
        const packet: Record<string, unknown> = { action: "sync", code: room.code };
        if (current?.status === "playing" && player && inputRef.current) Object.assign(packet, inputRef.current);
        const data = await post(packet);
        if (alive) apply(data.game as Game);
      } catch (syncError) {
        if (alive) setError(syncError instanceof Error ? syncError.message : "Hockey indisponible.");
      } finally {
        waiting = false;
      }
    };

    void sync();
    const id = window.setInterval(sync, 140);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [room.code, user.id, apply]);

  useEffect(() => {
    const active = game?.status === "playing" || game?.status === "gameover";
    document.body.classList.toggle("hockey-match-active", Boolean(active));
    onActiveChange?.(Boolean(active));
    return () => document.body.classList.remove("hockey-match-active");
  }, [game?.status, onActiveChange]);

  useEffect(() => {
    if (!me || game?.status !== "playing") {
      inputRef.current = null;
      setLocalPad(null);
      return;
    }
    const paddle = game.frame?.paddles?.[user.id] ?? initial(me, game.mode);
    inputRef.current = { x: paddle.x, y: paddle.y, vx: 0, vy: 0 };
    lastInputRef.current = { x: paddle.x, y: paddle.y, at: Date.now() };
    setLocalPad({ x: paddle.x, y: paddle.y });
  }, [game?.status, me?.userId, user.id]);

  const sendPosition = useCallback((x: number, y: number) => {
    const current = gameRef.current;
    const player = current?.players.find((entry) => entry.userId === user.id);
    if (!current || !player || current.status !== "playing") return;

    const point = clampPad(player.side, x, y);
    const now = Date.now();
    const dt = Math.max(0.018, (now - lastInputRef.current.at) / 1000);
    let vx = (point.x - lastInputRef.current.x) / dt;
    let vy = (point.y - lastInputRef.current.y) / dt;
    const speed = Math.hypot(vx, vy);
    if (speed > MAX_MALLET) {
      vx *= MAX_MALLET / speed;
      vy *= MAX_MALLET / speed;
    }

    lastInputRef.current = { x: point.x, y: point.y, at: now };
    inputRef.current = { x: point.x, y: point.y, vx, vy };
    setLocalPad(point);
  }, [user.id]);

  const pointer = (event: PointerEvent<HTMLDivElement>) => {
    const rect = rinkRef.current?.getBoundingClientRect();
    if (!rect) return;
    if (event.type === "pointerdown") event.currentTarget.setPointerCapture(event.pointerId);
    sendPosition((event.clientX - rect.left) / rect.width, (event.clientY - rect.top) / rect.height);
  };

  const configure = async (mode: Mode) => {
    try {
      setBusy(true);
      apply((await post({ action: "configure", code: room.code, mode })).game as Game);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Erreur.");
    } finally {
      setBusy(false);
    }
  };

  const start = async () => {
    try {
      setBusy(true);
      apply((await post({ action: "start", code: room.code })).game as Game);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Erreur.");
    } finally {
      setBusy(false);
    }
  };

  if (!game) {
    return <section className="hockeyLobby">
      <div className="spinner"/>
      <p>Chargement du hockey…</p>
      {error && <div className="errorBox">{error}</div>}
    </section>;
  }

  if (game.status === "lobby") {
    return <section className="hockeyLobby">
      <div className="hockeyHero">
        <div className="hockeyDisc">🏒</div>
        <div><span className="kicker">HOCKEY ARCADE</span><h2>Hockey sur glace</h2><p>Choisis le mode puis lance la partie.</p></div>
      </div>
      <div className="modePicker">
        <button className={game.mode === "1v1" ? "selected" : ""} disabled={!isHost || busy} onClick={() => void configure("1v1")}><strong>1 VS 1</strong><small>2 joueurs</small></button>
        <button className={game.mode === "2v2" ? "selected" : ""} disabled={!isHost || busy} onClick={() => void configure("2v2")}><strong>2 VS 2</strong><small>4 joueurs</small></button>
      </div>
      <div className="hockeyReadyBar">
        <span>{online}/{needed} joueurs connectés</span>
        {isHost ? <button className="primaryButton" disabled={busy || online < needed} onClick={() => void start()}>{busy ? "Lancement…" : `Lancer le ${game.mode}`}</button> : <small>En attente de l'hôte…</small>}
      </div>
      {error && <div className="errorBox">{error}</div>}
    </section>;
  }

  const frame = game.frame ?? {
    puck: { x: 0.5, y: 0.5, vx: 0, vy: 0 },
    paddles: Object.fromEntries(game.players.map((player) => [player.userId, initial(player, game.mode)])),
    leftScore: game.leftScore,
    rightScore: game.rightScore,
    winnerSide: game.winnerSide,
    pauseUntil: 0,
  };
  const winners = (frame.winnerSide === "left" ? left : right).map((player) => player.username).join(" & ");

  return <section className="hockeyGameWrap">
    <div className="hockeyGameTop">
      <div className="teamNames leftTeam"><small>BLEU</small><strong>{left.map((player) => player.username).join(" · ")}</strong></div>
      <div className="hockeyScore"><b>{frame.leftScore}</b><span>—</span><b>{frame.rightScore}</b></div>
      <div className="teamNames rightTeam"><small>ROUGE</small><strong>{right.map((player) => player.username).join(" · ")}</strong></div>
    </div>

    <div className="rinkFrame">
      <div
        ref={rinkRef}
        className={`hockeyRink ${me ? "controllable" : "spectating"}`}
        onPointerDown={pointer}
        onPointerMove={(event) => { if (event.buttons || event.pointerType === "touch") pointer(event); }}
      >
        <div className="rinkCenterLine"/>
        <div className="rinkCenterCircle"/>
        <div className="goal goalLeft"/>
        <div className="goal goalRight"/>
        <div className="goalCrease creaseLeft"/>
        <div className="goalCrease creaseRight"/>

        {game.players.map((player) => {
          const server = frame.paddles[player.userId] ?? initial(player, game.mode);
          const paddle = player.userId === user.id && localPad ? { ...server, ...localPad } : server;
          return <div
            key={player.userId}
            className={`hockeyMallet ${player.side} ${player.userId === user.id ? "mine" : ""}`}
            style={{ left: `${paddle.x * 100}%`, top: `${paddle.y * 100}%` }}
          ><span>{player.username.slice(0, 2).toUpperCase()}</span></div>;
        })}

        <div className="hockeyPuck" style={{ left: `${frame.puck.x * 100}%`, top: `${frame.puck.y * 100}%` }}/>

        {frame.winnerSide && <div className="hockeyWinnerOverlay">
          <span>🏆</span>
          <h2>{winners || "Équipe"} gagne !</h2>
          <p>{frame.leftScore} — {frame.rightScore}</p>
        </div>}
      </div>
    </div>

    {error && <div className="errorBox hockeyGameError">{error}</div>}
  </section>;
}
