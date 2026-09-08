"use client";

import { PointerEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

type User = { id: string; username: string };
type RoomMember = { id: string; username: string; online: boolean; joined_at: string };
type Room = { code: string; hostId: string; members: RoomMember[] };
type Mode = "1v1" | "2v2";
type Side = "left" | "right";
type Player = { userId: string; username: string; side: Side; slot: number };
type Game = {
  mode: Mode;
  status: "lobby" | "playing" | "gameover";
  authorityId: string | null;
  players: Player[];
  leftScore: number;
  rightScore: number;
  winnerSide: Side | null;
  targetScore: number;
};
type Paddle = { x: number; y: number; vx: number; vy: number };
type FrameState = {
  puck: { x: number; y: number; vx: number; vy: number };
  paddles: Record<string, Paddle>;
  leftScore: number;
  rightScore: number;
  winnerSide: Side | null;
  pauseUntil: number;
  version?: number;
};

type Props = {
  room: Room;
  user: User;
  onActiveChange?: (active: boolean) => void;
};

const MAX_MALLET_SPEED = 1.55;
const PLAY_TICK_MS = 72;
const LOBBY_TICK_MS = 260;

async function post(path: string, payload: Record<string, unknown>) {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    cache: "no-store",
  });
  const data = await res.json();
  if (!res.ok || !data.ok) throw new Error(data.error || "Erreur.");
  return data;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function capVector(x: number, y: number, max: number) {
  const speed = Math.hypot(x, y);
  if (speed <= max || speed <= 0.000001) return { x, y };
  const ratio = max / speed;
  return { x: x * ratio, y: y * ratio };
}

function initialPaddle(player: Player, mode: Mode): Paddle {
  return {
    x: player.side === "left" ? 0.2 : 0.8,
    y: mode === "1v1" ? 0.5 : player.slot === 0 ? 0.32 : 0.68,
    vx: 0,
    vy: 0,
  };
}

function clampPaddle(side: Side, x: number, y: number) {
  return {
    x: clamp(x, side === "left" ? 0.075 : 0.51, side === "left" ? 0.49 : 0.925),
    y: clamp(y, 0.085, 0.915),
  };
}

function baseFrame(game: Game): FrameState {
  return {
    puck: { x: 0.5, y: 0.5, vx: 0, vy: 0 },
    paddles: Object.fromEntries(game.players.map((player) => [player.userId, initialPaddle(player, game.mode)])),
    leftScore: game.leftScore,
    rightScore: game.rightScore,
    winnerSide: game.winnerSide,
    pauseUntil: 0,
  };
}

function lerp(a: number, b: number, amount: number) {
  return a + (b - a) * amount;
}

export default function HockeyGame({ room, user, onActiveChange }: Props) {
  const [game, setGame] = useState<Game | null>(null);
  const [frame, setFrame] = useState<FrameState | null>(null);
  const [localPaddle, setLocalPaddle] = useState<{ x: number; y: number } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const gameRef = useRef<Game | null>(null);
  const rinkRef = useRef<HTMLDivElement | null>(null);
  const inFlightRef = useRef(false);
  const draggingRef = useRef(false);
  const targetFrameRef = useRef<FrameState | null>(null);
  const shownFrameRef = useRef<FrameState | null>(null);
  const latestInputRef = useRef({ x: 0.5, y: 0.5, vx: 0, vy: 0, movedAt: 0 });
  const previousPointerRef = useRef({ x: 0.5, y: 0.5, at: Date.now() });

  useEffect(() => {
    gameRef.current = game;
    if (game) onActiveChange?.(game.status !== "lobby");
  }, [game, onActiveChange]);

  const me = useMemo(() => game?.players.find((player) => player.userId === user.id) ?? null, [game, user.id]);
  const leftPlayers = useMemo(() => game?.players.filter((player) => player.side === "left") ?? [], [game]);
  const rightPlayers = useMemo(() => game?.players.filter((player) => player.side === "right") ?? [], [game]);
  const isHost = room.hostId === user.id;
  const onlineCount = room.members.filter((member) => member.online).length;
  const needed = game?.mode === "2v2" ? 4 : 2;

  const applyFrame = useCallback((next: FrameState | null, nextGame: Game) => {
    const incoming = next ?? baseFrame(nextGame);
    targetFrameRef.current = incoming;

    const current = shownFrameRef.current;
    const scoreChanged = current && (current.leftScore !== incoming.leftScore || current.rightScore !== incoming.rightScore);
    const resetJump = current && Math.hypot(current.puck.x - incoming.puck.x, current.puck.y - incoming.puck.y) > 0.34;

    if (!current || scoreChanged || resetJump) {
      shownFrameRef.current = incoming;
      setFrame(incoming);
    }
  }, []);

  useEffect(() => {
    let raf = 0;
    const animate = () => {
      const target = targetFrameRef.current;
      const current = shownFrameRef.current;
      if (target && current) {
        const paddles: Record<string, Paddle> = {};
        const ids = new Set([...Object.keys(current.paddles), ...Object.keys(target.paddles)]);
        for (const id of ids) {
          const from = current.paddles[id] ?? target.paddles[id];
          const to = target.paddles[id] ?? from;
          paddles[id] = {
            x: lerp(from.x, to.x, 0.42),
            y: lerp(from.y, to.y, 0.42),
            vx: to.vx,
            vy: to.vy,
          };
        }

        const next: FrameState = {
          puck: {
            x: lerp(current.puck.x, target.puck.x, 0.38),
            y: lerp(current.puck.y, target.puck.y, 0.38),
            vx: target.puck.vx,
            vy: target.puck.vy,
          },
          paddles,
          leftScore: target.leftScore,
          rightScore: target.rightScore,
          winnerSide: target.winnerSide,
          pauseUntil: target.pauseUntil,
          version: target.version,
        };
        shownFrameRef.current = next;
        setFrame(next);
      }
      raf = requestAnimationFrame(animate);
    };
    raf = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(raf);
  }, []);

  const tick = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    try {
      const current = gameRef.current;
      const player = current?.players.find((entry) => entry.userId === user.id);
      const request: Record<string, unknown> = { action: "tick", code: room.code };

      if (current?.status === "playing" && player) {
        const latest = latestInputRef.current;
        const staleVelocity = Date.now() - latest.movedAt > 110;
        request.x = latest.x;
        request.y = latest.y;
        request.vx = staleVelocity ? 0 : latest.vx;
        request.vy = staleVelocity ? 0 : latest.vy;
      }

      const data = await post("/api/hockey", request);
      const nextGame = data.game as Game;
      gameRef.current = nextGame;
      setGame(nextGame);
      applyFrame((data.frame ?? null) as FrameState | null, nextGame);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Synchronisation impossible.");
    } finally {
      inFlightRef.current = false;
    }
  }, [applyFrame, room.code, user.id]);

  useEffect(() => {
    void tick();
    const delay = game?.status === "playing" || game?.status === "gameover" ? PLAY_TICK_MS : LOBBY_TICK_MS;
    const id = window.setInterval(() => void tick(), delay);
    return () => window.clearInterval(id);
  }, [tick, game?.status]);

  useEffect(() => {
    if (!game || !me || game.status !== "playing") {
      setLocalPaddle(null);
      return;
    }
    const start = frame?.paddles[me.userId] ?? initialPaddle(me, game.mode);
    latestInputRef.current = { x: start.x, y: start.y, vx: 0, vy: 0, movedAt: Date.now() };
    previousPointerRef.current = { x: start.x, y: start.y, at: Date.now() };
    setLocalPaddle({ x: start.x, y: start.y });
  }, [game?.status, game?.mode, me?.userId]);

  const moveLocal = useCallback((x: number, y: number) => {
    const current = gameRef.current;
    const player = current?.players.find((entry) => entry.userId === user.id);
    if (!current || current.status !== "playing" || !player) return;

    const point = clampPaddle(player.side, x, y);
    const now = Date.now();
    const previous = previousPointerRef.current;
    const seconds = Math.max(0.012, (now - previous.at) / 1000);
    const velocity = capVector((point.x - previous.x) / seconds, (point.y - previous.y) / seconds, MAX_MALLET_SPEED);

    previousPointerRef.current = { x: point.x, y: point.y, at: now };
    latestInputRef.current = { x: point.x, y: point.y, vx: velocity.x, vy: velocity.y, movedAt: now };
    setLocalPaddle(point);
  }, [user.id]);

  const pointerToRink = (event: PointerEvent<HTMLDivElement>) => {
    const rect = rinkRef.current?.getBoundingClientRect();
    if (!rect) return;
    moveLocal((event.clientX - rect.left) / rect.width, (event.clientY - rect.top) / rect.height);
  };

  const configure = async (mode: Mode) => {
    try {
      setBusy(true);
      setError("");
      const data = await post("/api/hockey", { action: "configure", code: room.code, mode });
      const next = data.game as Game;
      gameRef.current = next;
      setGame(next);
      targetFrameRef.current = null;
      shownFrameRef.current = null;
      setFrame(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur.");
    } finally {
      setBusy(false);
    }
  };

  const start = async () => {
    try {
      setBusy(true);
      setError("");
      const data = await post("/api/hockey", { action: "start", code: room.code });
      const nextGame = data.game as Game;
      const nextFrame = (data.frame ?? baseFrame(nextGame)) as FrameState;
      gameRef.current = nextGame;
      setGame(nextGame);
      targetFrameRef.current = nextFrame;
      shownFrameRef.current = nextFrame;
      setFrame(nextFrame);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur.");
    } finally {
      setBusy(false);
    }
  };

  const stop = async () => {
    try {
      setBusy(true);
      const data = await post("/api/hockey", { action: "stop", code: room.code });
      const next = data.game as Game;
      gameRef.current = next;
      setGame(next);
      targetFrameRef.current = null;
      shownFrameRef.current = null;
      setFrame(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur.");
    } finally {
      setBusy(false);
    }
  };

  if (!game) {
    return <section className="hockeyLobby"><div className="spinner"/><p>Chargement du hockey…</p></section>;
  }

  if (game.status === "lobby") {
    return <section className="hockeyLobby">
      <div className="hockeyHero">
        <div className="hockeyDisc">🏒</div>
        <div>
          <span className="kicker">HOCKEY ARCADE</span>
          <h2>Hockey sur glace</h2>
          <p>Chaque joueur contrôle son propre maillet dans une seule partie synchronisée.</p>
        </div>
      </div>

      <div className="modePicker">
        <button className={game.mode === "1v1" ? "selected" : ""} disabled={!isHost || busy} onClick={() => void configure("1v1")}>
          <strong>1 VS 1</strong><small>2 joueurs</small>
        </button>
        <button className={game.mode === "2v2" ? "selected" : ""} disabled={!isHost || busy} onClick={() => void configure("2v2")}>
          <strong>2 VS 2</strong><small>4 joueurs</small>
        </button>
      </div>

      <div className="hockeyRules">
        <div><b>7</b><span>Premier à 7 buts</span></div>
        <div><b>↗</b><span>Glisse ton maillet pour frapper</span></div>
        <div><b>◉</b><span>Rebonds physiques sur les bandes</span></div>
      </div>

      <div className="hockeyReadyBar">
        <span>{onlineCount}/{needed} joueurs connectés requis</span>
        {isHost
          ? <button className="primaryButton" disabled={busy || onlineCount < needed} onClick={() => void start()}>{busy ? "Lancement…" : `Lancer le ${game.mode}`}</button>
          : <small>En attente du lancement par l'hôte…</small>}
      </div>
      {error && <div className="errorBox">{error}</div>}
    </section>;
  }

  const shown = frame ?? baseFrame(game);
  const winnerNames = (shown.winnerSide === "left" ? leftPlayers : rightPlayers).map((player) => player.username).join(" & ");

  return <section className="hockeyGameWrap hockeyGameLive">
    <div className="hockeyGameTop hockeyScoreOnly">
      <div className="teamNames leftTeam"><strong>{leftPlayers.map((player) => player.username).join(" · ")}</strong></div>
      <div className="hockeyScore"><b>{shown.leftScore}</b><span>—</span><b>{shown.rightScore}</b></div>
      <div className="teamNames rightTeam"><strong>{rightPlayers.map((player) => player.username).join(" · ")}</strong></div>
    </div>

    <div className="rinkFrame hockeyLiveRinkFrame">
      <div
        ref={rinkRef}
        className={`hockeyRink ${me ? "controllable" : "spectating"}`}
        onPointerDown={(event) => {
          draggingRef.current = true;
          event.currentTarget.setPointerCapture(event.pointerId);
          pointerToRink(event);
        }}
        onPointerMove={(event) => {
          if (draggingRef.current || event.pointerType === "touch") pointerToRink(event);
        }}
        onPointerUp={(event) => {
          draggingRef.current = false;
          try { event.currentTarget.releasePointerCapture(event.pointerId); } catch {}
        }}
        onPointerCancel={() => { draggingRef.current = false; }}
      >
        <div className="rinkCenterLine"/>
        <div className="rinkCenterCircle"/>
        <div className="goal goalLeft"/>
        <div className="goal goalRight"/>
        <div className="goalCrease creaseLeft"/>
        <div className="goalCrease creaseRight"/>

        {game.players.map((player) => {
          const serverPad = shown.paddles[player.userId] ?? initialPaddle(player, game.mode);
          const pad = player.userId === user.id && localPaddle ? { ...serverPad, ...localPaddle } : serverPad;
          return <div
            key={player.userId}
            className={`hockeyMallet ${player.side} ${player.userId === user.id ? "mine" : ""}`}
            style={{ left: `${pad.x * 100}%`, top: `${pad.y * 100}%` }}
          ><span>{player.username.slice(0, 2).toUpperCase()}</span></div>;
        })}

        <div className="hockeyPuck" style={{ left: `${shown.puck.x * 100}%`, top: `${shown.puck.y * 100}%` }}/>

        {shown.pauseUntil > Date.now() && !shown.winnerSide && <div className="faceoffLabel">MISE EN JEU</div>}

        {shown.winnerSide && <div className="hockeyWinnerOverlay">
          <span>🏆</span>
          <h2>{winnerNames || "Équipe"} gagne !</h2>
          <p>{shown.leftScore} — {shown.rightScore}</p>
          {isHost && <div>
            <button className="primaryButton" disabled={busy} onClick={() => void start()}>Rejouer</button>
            <button className="secondaryButton" disabled={busy} onClick={() => void stop()}>Retour à la room</button>
          </div>}
        </div>}
      </div>
    </div>
  </section>;
}
