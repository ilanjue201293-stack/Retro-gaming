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
type Signal = { id: number; senderId: string; kind: "offer" | "answer" | "ice"; payload: unknown };
type Puck = { x: number; y: number; vx: number; vy: number };
type Paddle = { x: number; y: number; vx: number; vy: number };
type FrameState = {
  puck: Puck;
  paddles: Record<string, Paddle>;
  leftScore: number;
  rightScore: number;
  winnerSide: Side | null;
  pauseUntil: number;
};
type PeerEntry = { pc: RTCPeerConnection; dc: RTCDataChannel | null };

const ICE_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
];
const PUCK_R = 0.026;
const MALLET_R = 0.055;
const LEFT_BOARD = 0.035;
const RIGHT_BOARD = 0.965;
const TOP_BOARD = 0.055;
const BOTTOM_BOARD = 0.945;
const GOAL_MIN = 0.365;
const GOAL_MAX = 0.635;
const MAX_PUCK_SPEED = 2.35;

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
  const x = player.side === "left" ? 0.2 : 0.8;
  const y = mode === "1v1" ? 0.5 : player.slot === 0 ? 0.34 : 0.66;
  return { x, y, vx: 0, vy: 0 };
}

function clampPaddle(side: Side, x: number, y: number) {
  return {
    x: Math.max(side === "left" ? 0.075 : 0.53, Math.min(side === "left" ? 0.47 : 0.925, x)),
    y: Math.max(0.095, Math.min(0.905, y)),
  };
}

export default function HockeyGame({ room, user }: { room: Room; user: User }) {
  const [game, setGame] = useState<Game | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [frame, setFrame] = useState<FrameState | null>(null);
  const [network, setNetwork] = useState("Connexion au match…");
  const [localPaddle, setLocalPaddle] = useState<{ x: number; y: number } | null>(null);
  const gameRef = useRef<Game | null>(null);
  const cursorRef = useRef(0);
  const peersRef = useRef<Map<string, PeerEntry>>(new Map());
  const pendingIceRef = useRef<Map<string, RTCIceCandidateInit[]>>(new Map());
  const connectingRef = useRef(false);
  const localInputRef = useRef({ x: 0.5, y: 0.5, at: performance.now() });
  const rinkRef = useRef<HTMLDivElement | null>(null);
  const simRef = useRef<{
    key: string;
    puck: Puck;
    paddles: Record<string, Paddle>;
    leftScore: number;
    rightScore: number;
    winnerSide: Side | null;
    pauseUntil: number;
    lastTs: number;
    lastBroadcast: number;
    lastCheckpoint: number;
  } | null>(null);

  useEffect(() => { gameRef.current = game; }, [game]);

  const me = useMemo(() => game?.players.find((p) => p.userId === user.id) ?? null, [game, user.id]);
  const leftPlayers = useMemo(() => game?.players.filter((p) => p.side === "left") ?? [], [game]);
  const rightPlayers = useMemo(() => game?.players.filter((p) => p.side === "right") ?? [], [game]);
  const isHost = room.hostId === user.id;
  const onlineCount = room.members.filter((m) => m.online).length;
  const needed = game?.mode === "2v2" ? 4 : 2;

  const refresh = useCallback(async () => {
    try {
      const data = await post("/api/hockey", { action: "state", code: room.code });
      setGame(data.game);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Hockey indisponible.");
    }
  }, [room.code]);

  useEffect(() => {
    void refresh();
    const id = window.setInterval(() => void refresh(), 1500);
    return () => clearInterval(id);
  }, [refresh]);

  const closePeers = useCallback(() => {
    for (const entry of peersRef.current.values()) {
      try { entry.dc?.close(); } catch {}
      try { entry.pc.close(); } catch {}
    }
    peersRef.current.clear();
    pendingIceRef.current.clear();
    connectingRef.current = false;
    cursorRef.current = 0;
  }, []);

  useEffect(() => {
    if (!game || game.status === "lobby") {
      closePeers();
      simRef.current = null;
      setFrame(null);
      setLocalPaddle(null);
      setNetwork("En attente du lancement");
    }
  }, [game?.status, closePeers]);

  useEffect(() => () => closePeers(), [closePeers]);

  const sendSignal = useCallback(async (targetId: string, kind: Signal["kind"], payload: unknown) => {
    await post("/api/hockey", { action: "signal", code: room.code, targetId, kind, payload });
  }, [room.code]);

  const flushIce = useCallback(async (peerId: string, pc: RTCPeerConnection) => {
    if (!pc.remoteDescription) return;
    const queue = pendingIceRef.current.get(peerId) ?? [];
    pendingIceRef.current.set(peerId, []);
    for (const ice of queue) {
      try { await pc.addIceCandidate(ice); } catch {}
    }
  }, []);

  const attachDataChannel = useCallback((peerId: string, dc: RTCDataChannel, hostSide: boolean) => {
    const entry = peersRef.current.get(peerId);
    if (entry) entry.dc = dc;
    dc.onopen = () => {
      setNetwork(hostSide ? "Match connecté" : "Connecté à l'hôte");
      connectingRef.current = false;
    };
    dc.onclose = () => {
      if (!hostSide) connectingRef.current = false;
      setNetwork("Reconnexion…");
    };
    dc.onerror = () => setNetwork("Connexion instable");
    dc.onmessage = (event) => {
      try {
        const msg = JSON.parse(String(event.data));
        if (hostSide && msg.type === "input") {
          const active = gameRef.current?.players.find((p) => p.userId === peerId);
          const sim = simRef.current;
          if (!active || !sim) return;
          const clamped = clampPaddle(active.side, Number(msg.x), Number(msg.y));
          const pad = sim.paddles[peerId] ?? initialPaddle(active, gameRef.current?.mode ?? "1v1");
          pad.x = clamped.x;
          pad.y = clamped.y;
          pad.vx = Math.max(-2.2, Math.min(2.2, Number(msg.vx) || 0));
          pad.vy = Math.max(-2.2, Math.min(2.2, Number(msg.vy) || 0));
          sim.paddles[peerId] = pad;
        } else if (!hostSide && msg.type === "state") {
          setFrame(msg.state as FrameState);
        }
      } catch {}
    };
  }, []);

  const createPeer = useCallback((peerId: string, hostSide: boolean) => {
    const existing = peersRef.current.get(peerId);
    if (existing) return existing;
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    const entry: PeerEntry = { pc, dc: null };
    peersRef.current.set(peerId, entry);
    pc.onicecandidate = (event) => {
      if (event.candidate) void sendSignal(peerId, "ice", event.candidate.toJSON()).catch(() => undefined);
    };
    pc.onconnectionstatechange = () => {
      if (["failed", "closed", "disconnected"].includes(pc.connectionState)) {
        setNetwork("Reconnexion…");
        if (!hostSide) connectingRef.current = false;
      }
    };
    if (hostSide) {
      pc.ondatachannel = (event) => attachDataChannel(peerId, event.channel, true);
    }
    return entry;
  }, [attachDataChannel, sendSignal]);

  const startClientConnection = useCallback(async (authorityId: string) => {
    if (authorityId === user.id || connectingRef.current) return;
    const old = peersRef.current.get(authorityId);
    if (old?.dc?.readyState === "open") return;
    if (old) {
      try { old.pc.close(); } catch {}
      peersRef.current.delete(authorityId);
    }
    connectingRef.current = true;
    try {
      const entry = createPeer(authorityId, false);
      const dc = entry.pc.createDataChannel("retro-hockey", { ordered: false, maxRetransmits: 0 });
      entry.dc = dc;
      attachDataChannel(authorityId, dc, false);
      const offer = await entry.pc.createOffer();
      await entry.pc.setLocalDescription(offer);
      await sendSignal(authorityId, "offer", offer);
      setNetwork("Connexion à l'hôte…");
    } catch {
      connectingRef.current = false;
      setNetwork("Reconnexion…");
    }
  }, [attachDataChannel, createPeer, sendSignal, user.id]);

  const handleSignal = useCallback(async (signal: Signal) => {
    const current = gameRef.current;
    if (!current || current.status === "lobby") return;
    const authorityId = current.authorityId;
    if (!authorityId) return;

    if (user.id === authorityId) {
      if (signal.kind === "offer") {
        const entry = createPeer(signal.senderId, true);
        try {
          await entry.pc.setRemoteDescription(signal.payload as RTCSessionDescriptionInit);
          await flushIce(signal.senderId, entry.pc);
          const answer = await entry.pc.createAnswer();
          await entry.pc.setLocalDescription(answer);
          await sendSignal(signal.senderId, "answer", answer);
        } catch {}
      } else if (signal.kind === "ice") {
        const entry = peersRef.current.get(signal.senderId);
        const ice = signal.payload as RTCIceCandidateInit;
        if (entry?.pc.remoteDescription) {
          try { await entry.pc.addIceCandidate(ice); } catch {}
        } else {
          const q = pendingIceRef.current.get(signal.senderId) ?? [];
          q.push(ice);
          pendingIceRef.current.set(signal.senderId, q);
        }
      }
      return;
    }

    if (signal.senderId !== authorityId) return;
    const entry = peersRef.current.get(authorityId);
    if (signal.kind === "answer" && entry) {
      try {
        await entry.pc.setRemoteDescription(signal.payload as RTCSessionDescriptionInit);
        await flushIce(authorityId, entry.pc);
      } catch {}
    } else if (signal.kind === "ice") {
      const ice = signal.payload as RTCIceCandidateInit;
      if (entry?.pc.remoteDescription) {
        try { await entry.pc.addIceCandidate(ice); } catch {}
      } else {
        const q = pendingIceRef.current.get(authorityId) ?? [];
        q.push(ice);
        pendingIceRef.current.set(authorityId, q);
      }
    }
  }, [createPeer, flushIce, sendSignal, user.id]);

  useEffect(() => {
    if (!game || game.status === "lobby" || !game.authorityId) return;
    let alive = true;
    let busyPoll = false;
    const poll = async () => {
      if (!alive || busyPoll) return;
      busyPoll = true;
      try {
        const data = await post("/api/hockey", { action: "poll", code: room.code, after: cursorRef.current });
        if (!alive) return;
        setGame(data.game);
        cursorRef.current = Number(data.cursor ?? cursorRef.current);
        for (const signal of data.signals as Signal[]) await handleSignal(signal);
        if (data.game.status !== "lobby" && data.game.authorityId && data.game.authorityId !== user.id) {
          void startClientConnection(data.game.authorityId);
        }
      } catch {}
      finally { busyPoll = false; }
    };
    void poll();
    const id = window.setInterval(poll, 350);
    return () => { alive = false; clearInterval(id); };
  }, [game?.status, game?.authorityId, handleSignal, room.code, startClientConnection, user.id]);

  const initializeSimulation = useCallback((current: Game) => {
    const key = `${current.authorityId}:${current.mode}:${current.players.map((p) => p.userId).join(",")}:${current.leftScore}:${current.rightScore}`;
    if (simRef.current?.key === key) return;
    const paddles: Record<string, Paddle> = {};
    for (const player of current.players) paddles[player.userId] = initialPaddle(player, current.mode);
    simRef.current = {
      key,
      puck: { x: 0.5, y: 0.5, vx: 0, vy: 0 },
      paddles,
      leftScore: current.leftScore,
      rightScore: current.rightScore,
      winnerSide: current.winnerSide,
      pauseUntil: performance.now() + 650,
      lastTs: performance.now(),
      lastBroadcast: 0,
      lastCheckpoint: 0,
    };
    setFrame({
      puck: { x: 0.5, y: 0.5, vx: 0, vy: 0 }, paddles,
      leftScore: current.leftScore, rightScore: current.rightScore,
      winnerSide: current.winnerSide, pauseUntil: performance.now() + 650,
    });
  }, []);

  const checkpoint = useCallback(async (leftScore: number, rightScore: number) => {
    try {
      const data = await post("/api/hockey", { action: "checkpoint", code: room.code, leftScore, rightScore });
      setGame(data.game);
    } catch {}
  }, [room.code]);

  useEffect(() => {
    if (!game || game.authorityId !== user.id || (game.status !== "playing" && game.status !== "gameover")) return;
    initializeSimulation(game);
    let raf = 0;

    const tick = (now: number) => {
      const current = gameRef.current;
      const sim = simRef.current;
      if (!current || !sim || current.authorityId !== user.id || current.status === "lobby") return;
      const dt = Math.max(0.001, Math.min(0.03, (now - sim.lastTs) / 1000));
      sim.lastTs = now;

      if (!sim.winnerSide && now >= sim.pauseUntil) {
        const puck = sim.puck;
        puck.x += puck.vx * dt;
        puck.y += puck.vy * dt;
        const friction = Math.pow(0.996, dt * 60);
        puck.vx *= friction;
        puck.vy *= friction;
        if (Math.hypot(puck.vx, puck.vy) < 0.015) { puck.vx = 0; puck.vy = 0; }

        if (puck.y - PUCK_R < TOP_BOARD) {
          puck.y = TOP_BOARD + PUCK_R;
          puck.vy = Math.abs(puck.vy);
        }
        if (puck.y + PUCK_R > BOTTOM_BOARD) {
          puck.y = BOTTOM_BOARD - PUCK_R;
          puck.vy = -Math.abs(puck.vy);
        }

        const inGoalLane = puck.y > GOAL_MIN && puck.y < GOAL_MAX;
        if (!inGoalLane && puck.x - PUCK_R < LEFT_BOARD) {
          puck.x = LEFT_BOARD + PUCK_R;
          puck.vx = Math.abs(puck.vx);
        }
        if (!inGoalLane && puck.x + PUCK_R > RIGHT_BOARD) {
          puck.x = RIGHT_BOARD - PUCK_R;
          puck.vx = -Math.abs(puck.vx);
        }

        if (inGoalLane && puck.x < -0.02) {
          sim.rightScore += 1;
          sim.puck = { x: 0.5, y: 0.5, vx: 0, vy: 0 };
          sim.pauseUntil = now + 850;
          if (sim.rightScore >= 7) sim.winnerSide = "right";
          void checkpoint(sim.leftScore, sim.rightScore);
        } else if (inGoalLane && puck.x > 1.02) {
          sim.leftScore += 1;
          sim.puck = { x: 0.5, y: 0.5, vx: 0, vy: 0 };
          sim.pauseUntil = now + 850;
          if (sim.leftScore >= 7) sim.winnerSide = "left";
          void checkpoint(sim.leftScore, sim.rightScore);
        }

        for (const player of current.players) {
          const pad = sim.paddles[player.userId];
          if (!pad) continue;
          const dx = sim.puck.x - pad.x;
          const dy = sim.puck.y - pad.y;
          const distance = Math.hypot(dx, dy);
          const minDistance = PUCK_R + MALLET_R;
          if (distance <= 0 || distance >= minDistance) continue;
          const nx = dx / distance;
          const ny = dy / distance;
          sim.puck.x = pad.x + nx * minDistance;
          sim.puck.y = pad.y + ny * minDistance;
          const rvx = sim.puck.vx - pad.vx;
          const rvy = sim.puck.vy - pad.vy;
          const toward = rvx * nx + rvy * ny;
          if (toward < 0) {
            const reflectedX = rvx - 2 * toward * nx;
            const reflectedY = rvy - 2 * toward * ny;
            sim.puck.vx = reflectedX + pad.vx * 0.9;
            sim.puck.vy = reflectedY + pad.vy * 0.9;
          } else {
            sim.puck.vx += pad.vx * 0.48 + nx * 0.06;
            sim.puck.vy += pad.vy * 0.48 + ny * 0.06;
          }
          let speed = Math.hypot(sim.puck.vx, sim.puck.vy);
          if (speed > 0.02) {
            speed *= 1.025;
            const capped = Math.min(MAX_PUCK_SPEED, Math.max(0.22, speed));
            const ratio = capped / speed;
            sim.puck.vx *= ratio;
            sim.puck.vy *= ratio;
          }
        }
      }

      const state: FrameState = {
        puck: { ...sim.puck },
        paddles: Object.fromEntries(Object.entries(sim.paddles).map(([id, p]) => [id, { ...p }])),
        leftScore: sim.leftScore,
        rightScore: sim.rightScore,
        winnerSide: sim.winnerSide,
        pauseUntil: sim.pauseUntil,
      };

      if (now - sim.lastBroadcast > 32) {
        sim.lastBroadcast = now;
        setFrame(state);
        const packet = JSON.stringify({ type: "state", state });
        for (const entry of peersRef.current.values()) {
          if (entry.dc?.readyState === "open") {
            try { entry.dc.send(packet); } catch {}
          }
        }
      }
      if (now - sim.lastCheckpoint > 1500) {
        sim.lastCheckpoint = now;
        void checkpoint(sim.leftScore, sim.rightScore);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [game?.authorityId, game?.status, checkpoint, initializeSimulation, user.id]);

  const sendInput = useCallback((x: number, y: number) => {
    const current = gameRef.current;
    const player = current?.players.find((p) => p.userId === user.id);
    if (!current || !player || current.status !== "playing") return;
    const point = clampPaddle(player.side, x, y);
    const now = performance.now();
    const last = localInputRef.current;
    const seconds = Math.max(0.012, (now - last.at) / 1000);
    const vx = Math.max(-2.2, Math.min(2.2, (point.x - last.x) / seconds));
    const vy = Math.max(-2.2, Math.min(2.2, (point.y - last.y) / seconds));
    localInputRef.current = { x: point.x, y: point.y, at: now };
    setLocalPaddle(point);

    if (current.authorityId === user.id) {
      const sim = simRef.current;
      if (!sim) return;
      const pad = sim.paddles[user.id] ?? initialPaddle(player, current.mode);
      pad.x = point.x; pad.y = point.y; pad.vx = vx; pad.vy = vy;
      sim.paddles[user.id] = pad;
    } else if (current.authorityId) {
      const dc = peersRef.current.get(current.authorityId)?.dc;
      if (dc?.readyState === "open") {
        try { dc.send(JSON.stringify({ type: "input", x: point.x, y: point.y, vx, vy })); } catch {}
      }
    }
  }, [user.id]);

  const pointerToRink = (event: PointerEvent<HTMLDivElement>) => {
    const rect = rinkRef.current?.getBoundingClientRect();
    if (!rect) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    sendInput((event.clientX - rect.left) / rect.width, (event.clientY - rect.top) / rect.height);
  };

  const configure = async (mode: Mode) => {
    try {
      setBusy(true); setError("");
      const data = await post("/api/hockey", { action: "configure", code: room.code, mode });
      setGame(data.game);
    } catch (e) { setError(e instanceof Error ? e.message : "Erreur."); }
    finally { setBusy(false); }
  };

  const start = async () => {
    try {
      setBusy(true); setError("");
      const data = await post("/api/hockey", { action: "start", code: room.code });
      closePeers();
      setGame(data.game);
      setNetwork("Initialisation du match…");
    } catch (e) { setError(e instanceof Error ? e.message : "Erreur."); }
    finally { setBusy(false); }
  };

  const stop = async () => {
    try {
      setBusy(true); setError("");
      const data = await post("/api/hockey", { action: "stop", code: room.code });
      closePeers();
      setGame(data.game);
    } catch (e) { setError(e instanceof Error ? e.message : "Erreur."); }
    finally { setBusy(false); }
  };

  if (!game) {
    return <section className="hockeyLobby"><div className="spinner"/><p>Chargement du hockey…</p></section>;
  }

  if (game.status === "lobby") {
    return <section className="hockeyLobby">
      <div className="hockeyHero">
        <div className="hockeyDisc">🏒</div>
        <div>
          <span className="kicker">PREMIER JEU</span>
          <h2>Hockey Arcade</h2>
          <p>Vue du dessus, palet physique, rebonds sur les bandes et buts. Déplace ton maillet librement dans ta moitié de patinoire.</p>
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
        <div><b>↗</b><span>Plus tu frappes fort, plus le palet part vite</span></div>
        <div><b>◉</b><span>Le palet rebondit sur les bandes</span></div>
      </div>

      <div className="hockeyReadyBar">
        <span>{onlineCount}/{needed} joueurs connectés requis</span>
        {isHost ? <button className="primaryButton" disabled={busy || onlineCount < needed} onClick={() => void start()}>{busy ? "Lancement…" : `Lancer le ${game.mode}`}</button> : <small>En attente du lancement par l'hôte…</small>}
      </div>
      {error && <div className="errorBox">{error}</div>}
    </section>;
  }

  const shown = frame ?? {
    puck: { x: 0.5, y: 0.5, vx: 0, vy: 0 },
    paddles: Object.fromEntries(game.players.map((p) => [p.userId, initialPaddle(p, game.mode)])),
    leftScore: game.leftScore,
    rightScore: game.rightScore,
    winnerSide: game.winnerSide,
    pauseUntil: 0,
  };
  const winnerNames = (shown.winnerSide === "left" ? leftPlayers : rightPlayers).map((p) => p.username).join(" & ");

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
        onPointerMove={(e) => { if (e.buttons || e.pointerType === "touch") pointerToRink(e); }}
      >
        <div className="rinkCenterLine"/><div className="rinkCenterCircle"/>
        <div className="goal goalLeft"/><div className="goal goalRight"/>
        <div className="goalCrease creaseLeft"/><div className="goalCrease creaseRight"/>

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

        {shown.pauseUntil > performance.now() && !shown.winnerSide && <div className="faceoffLabel">MISE EN JEU</div>}
        {shown.winnerSide && <div className="hockeyWinnerOverlay"><span>🏆</span><h2>{winnerNames || "Équipe"} gagne !</h2><p>{shown.leftScore} — {shown.rightScore}</p>{isHost && <div><button className="primaryButton" onClick={() => void start()}>Rejouer</button><button className="secondaryButton" onClick={() => void stop()}>Retour</button></div>}</div>}
      </div>
    </div>

    <div className="hockeyFooter">
      <span className={`netDot ${network.includes("Connect") || isHost ? "ok" : ""}`}/><small>{isHost ? "Tu héberges la physique du match" : network}</small>
      <b>{me ? `Tu joues à ${me.side === "left" ? "gauche" : "droite"}` : "Mode spectateur"}</b>
    </div>
    {error && <div className="errorBox">{error}</div>}
  </section>;
}
