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

const MAX_MALLET_SPEED = 1.25;
const POLL_MS = 65;
const INPUT_MS = 42;

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

function initialPaddle(player: Player, mode: Mode): Paddle {
  return {
    x: player.side === "left" ? 0.2 : 0.8,
    y: mode === "1v1" ? 0.5 : player.slot === 0 ? 0.34 : 0.66,
    vx: 0,
    vy: 0,
  };
}

function clampPaddle(side: Side, x: number, y: number) {
  return {
    x: Math.max(side === "left" ? 0.075 : 0.53, Math.min(side === "left" ? 0.47 : 0.925, x)),
    y: Math.max(0.085, Math.min(0.915, y)),
  };
}

function baseFrame(game: Game): FrameState {
  return {
    puck: { x: 0.5, y: 0.5, vx: 0, vy: 0 },
    paddles: Object.fromEntries(game.players.map((p) => [p.userId, initialPaddle(p, game.mode)])),
    leftScore: game.leftScore,
    rightScore: game.rightScore,
    winnerSide: game.winnerSide,
    pauseUntil: 0,
  };
}

function lerp(a: number, b: number, amount: number) {
  return a + (b - a) * amount;
}

export default function HockeyGame({ room, user }: { room: Room; user: User }) {
  const [game, setGame] = useState<Game | null>(null);
  const [frame, setFrame] = useState<FrameState | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [network, setNetwork] = useState("Synchronisation serveur…");
  const [localPaddle, setLocalPaddle] = useState<{ x: number; y: number } | null>(null);

  const gameRef = useRef<Game | null>(null);
  const targetFrameRef = useRef<FrameState | null>(null);
  const shownFrameRef = useRef<FrameState | null>(null);
  const rinkRef = useRef<HTMLDivElement | null>(null);
  const pollingRef = useRef(false);
  const localInputRef = useRef({ x: 0.5, y: 0.5, at: Date.now() });
  const lastInputSentRef = useRef(0);
  const trailingInputRef = useRef<number | null>(null);
  const pendingInputRef = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null);

  useEffect(() => { gameRef.current = game; }, [game]);

  const me = useMemo(() => game?.players.find((p) => p.userId === user.id) ?? null, [game, user.id]);
  const leftPlayers = useMemo(() => game?.players.filter((p) => p.side === "left") ?? [], [game]);
  const rightPlayers = useMemo(() => game?.players.filter((p) => p.side === "right") ?? [], [game]);
  const isHost = room.hostId === user.id;
  const onlineCount = room.members.filter((m) => m.online).length;
  const needed = game?.mode === "2v2" ? 4 : 2;

  const applyServerFrame = useCallback((next: FrameState | null, nextGame: Game) => {
    if (!next) {
      const base = baseFrame(nextGame);
      targetFrameRef.current = base;
      if (!shownFrameRef.current) {
        shownFrameRef.current = base;
        setFrame(base);
      }
      return;
    }

    const current = shownFrameRef.current;
    const scoreChanged = current && (current.leftScore !== next.leftScore || current.rightScore !== next.rightScore);
    const hugeJump = current && Math.hypot(current.puck.x - next.puck.x, current.puck.y - next.puck.y) > 0.28;
    targetFrameRef.current = next;

    if (!current || scoreChanged || hugeJump) {
      shownFrameRef.current = next;
      setFrame(next);
    }
  }, []);

  useEffect(() => {
    let raf = 0;
    const animate = () => {
      const target = targetFrameRef.current;
      const current = shownFrameRef.current;
      if (target && current) {
        const nextPaddles: Record<string, Paddle> = {};
        const ids = new Set([...Object.keys(current.paddles), ...Object.keys(target.paddles)]);
        for (const id of ids) {
          const a = current.paddles[id] ?? target.paddles[id];
          const b = target.paddles[id] ?? a;
          nextPaddles[id] = {
            x: lerp(a.x, b.x, 0.34),
            y: lerp(a.y, b.y, 0.34),
            vx: b.vx,
            vy: b.vy,
          };
        }
        const next: FrameState = {
          puck: {
            x: lerp(current.puck.x, target.puck.x, 0.3),
            y: lerp(current.puck.y, target.puck.y, 0.3),
            vx: target.puck.vx,
            vy: target.puck.vy,
          },
          paddles: nextPaddles,
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

  const poll = useCallback(async () => {
    if (pollingRef.current) return;
    pollingRef.current = true;
    try {
      const data = await post("/api/hockey", { action: "poll", code: room.code });
      const nextGame = data.game as Game;
      gameRef.current = nextGame;
      setGame(nextGame);
      applyServerFrame((data.frame ?? null) as FrameState | null, nextGame);
      setNetwork("Serveur synchronisé");
      setError("");
    } catch (e) {
      setNetwork("Reconnexion serveur…");
      setError(e instanceof Error ? e.message : "Hockey indisponible.");
    } finally {
      pollingRef.current = false;
    }
  }, [applyServerFrame, room.code]);

  useEffect(() => {
    void poll();
    const id = window.setInterval(() => void poll(), game?.status === "lobby" ? 260 : POLL_MS);
    return () => window.clearInterval(id);
  }, [poll, game?.status]);

  useEffect(() => {
    if (!game || !me || game.status !== "playing") {
      setLocalPaddle(null);
      return;
    }
    const start = frame?.paddles[me.userId] ?? initialPaddle(me, game.mode);
    localInputRef.current = { x: start.x, y: start.y, at: Date.now() };
    setLocalPaddle({ x: start.x, y: start.y });
  }, [game?.status, game?.mode, me?.userId]);

  const sendInputNow = useCallback((input: { x: number; y: number; vx: number; vy: number }) => {
    lastInputSentRef.current = Date.now();
    pendingInputRef.current = null;
    void post("/api/hockey", { action: "input", code: room.code, ...input }).catch(() => {
      setNetwork("Reconnexion serveur…");
    });
  }, [room.code]);

  const queueInput = useCallback((input: { x: number; y: number; vx: number; vy: number }) => {
    pendingInputRef.current = input;
    const elapsed = Date.now() - lastInputSentRef.current;
    if (elapsed >= INPUT_MS) {
      sendInputNow(input);
      return;
    }
    if (trailingInputRef.current !== null) return;
    trailingInputRef.current = window.setTimeout(() => {
      trailingInputRef.current = null;
      const pending = pendingInputRef.current;
      if (pending) sendInputNow(pending);
    }, INPUT_MS - elapsed);
  }, [sendInputNow]);

  useEffect(() => () => {
    if (trailingInputRef.current !== null) window.clearTimeout(trailingInputRef.current);
  }, []);

  const sendInput = useCallback((x: number, y: number) => {
    const current = gameRef.current;
    const player = current?.players.find((p) => p.userId === user.id);
    if (!current || !player || current.status !== "playing") return;

    const point = clampPaddle(player.side, x, y);
    const now = Date.now();
    const last = localInputRef.current;
    const seconds = Math.max(0.014, (now - last.at) / 1000);
    const vx = Math.max(-MAX_MALLET_SPEED, Math.min(MAX_MALLET_SPEED, (point.x - last.x) / seconds));
    const vy = Math.max(-MAX_MALLET_SPEED, Math.min(MAX_MALLET_SPEED, (point.y - last.y) / seconds));
    localInputRef.current = { x: point.x, y: point.y, at: now };
    setLocalPaddle(point);
    queueInput({ x: point.x, y: point.y, vx, vy });
  }, [queueInput, user.id]);

  const pointerToRink = (event: PointerEvent<HTMLDivElement>) => {
    const rect = rinkRef.current?.getBoundingClientRect();
    if (!rect) return;
    if (event.type === "pointerdown") event.currentTarget.setPointerCapture(event.pointerId);
    sendInput((event.clientX - rect.left) / rect.width, (event.clientY - rect.top) / rect.height);
  };

  const configure = async (mode: Mode) => {
    try {
      setBusy(true); setError("");
      const data = await post("/api/hockey", { action: "configure", code: room.code, mode });
      gameRef.current = data.game;
      setGame(data.game);
      targetFrameRef.current = null;
      shownFrameRef.current = null;
      setFrame(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur.");
    } finally { setBusy(false); }
  };

  const start = async () => {
    try {
      setBusy(true); setError("");
      const data = await post("/api/hockey", { action: "start", code: room.code });
      const next = data.game as Game;
      gameRef.current = next;
      setGame(next);
      const base = baseFrame(next);
      targetFrameRef.current = base;
      shownFrameRef.current = base;
      setFrame(base);
      setNetwork("Lancement…");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur.");
    } finally { setBusy(false); }
  };

  const stop = async () => {
    try {
      setBusy(true); setError("");
      const data = await post("/api/hockey", { action: "stop", code: room.code });
      gameRef.current = data.game;
      setGame(data.game);
      targetFrameRef.current = null;
      shownFrameRef.current = null;
      setFrame(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur.");
    } finally { setBusy(false); }
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
          <p>Vue du dessus, palet physique, rebonds sur les bandes et buts. Chaque joueur contrôle réellement son maillet dans la même simulation.</p>
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
        <div><b>↗</b><span>La vitesse de ton geste influence le tir</span></div>
        <div><b>◉</b><span>Le palet glisse et rebondit sur les bandes</span></div>
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
  const winnerNames = (shown.winnerSide === "left" ? leftPlayers : rightPlayers).map((p) => p.username).join(" & ");
  const synced = network === "Serveur synchronisé";

  return <section className="hockeyGameWrap">
    <div className="hockeyGameTop">
      <div className="teamNames leftTeam"><small>ÉQUIPE BLEUE</small><strong>{leftPlayers.map((p) => p.username).join(" · ")}</strong></div>
      <div className="hockeyScore"><b>{shown.leftScore}</b><span>—</span><b>{shown.rightScore}</b></div>
      <div className="teamNames rightTeam"><small>ÉQUIPE ROUGE</small><strong>{rightPlayers.map((p) => p.username).join(" · ")}</strong></div>
    </div>

    <div className="rinkFrame">
      <div
        ref={rinkRef}
        className={`hockeyRink ${me ? "controllable" : "spectating"}`}
        onPointerDown={pointerToRink}
        onPointerMove={(event) => {
          if (event.buttons || event.pointerType === "touch") pointerToRink(event);
        }}
      >
        <div className="rinkCenterLine"/>
        <div className="rinkCenterCircle"/>
        <div className="goal goalLeft"/>
        <div className="goal goalRight"/>
        <div className="goalCrease creaseLeft"/>
        <div className="goalCrease creaseRight"/>

        {game.players.map((player) => {
          const base = shown.paddles[player.userId] ?? initialPaddle(player, game.mode);
          const pad = player.userId === user.id && localPaddle ? { ...base, ...localPaddle } : base;
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
          {isHost && <div><button className="primaryButton" onClick={() => void start()}>Rejouer</button><button className="secondaryButton" onClick={() => void stop()}>Retour</button></div>}
        </div>}
      </div>
    </div>

    <div className="hockeyFooter">
      <span className={`netDot ${synced ? "ok" : ""}`}/>
      <small>{network}</small>
      <b>{me ? `Tu joues à ${me.side === "left" ? "gauche" : "droite"}` : "Mode spectateur"}</b>
    </div>
    {error && <div className="errorBox">{error}</div>}
  </section>;
}
