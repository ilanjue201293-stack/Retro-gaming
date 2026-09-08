"use client";

import { PointerEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

type User = { id: string; username: string };
type RoomMember = { id: string; username: string; online: boolean; joined_at: string };
type Room = { code: string; hostId: string; members: RoomMember[] };
type Side = "left" | "right";
type BotDifficulty = "easy" | "normal" | "hard";
type Player = { userId: string; username: string; side: Side; isBot?: boolean; difficulty?: BotDifficulty };
type Paddle = { y: number; vy: number };
type Ball = { x: number; y: number; vx: number; vy: number };
type Frame = {
  ball: Ball;
  paddles: Record<string, Paddle>;
  leftScore: number;
  rightScore: number;
  winnerSide: Side | null;
  pauseUntil: number;
  serveDir: -1 | 1;
};
type Game = {
  status: "lobby" | "playing" | "gameover";
  players: Player[];
  leftScore: number;
  rightScore: number;
  winnerSide: Side | null;
  targetScore: number;
  timeLimitSec: number;
  startedAt: number | null;
  endsAt: number | null;
};
type Signal = { id: number; senderId: string; kind: "offer" | "answer" | "ice" | "input" | "state"; payload: unknown };
type PeerEntry = { pc: RTCPeerConnection; dc: RTCDataChannel | null };
type Simulation = {
  frame: Frame;
  targets: Record<string, number>;
  lastTs: number;
  lastBroadcast: number;
  lastFallbackBroadcast: number;
  lastCheckpointLeft: number;
  lastCheckpointRight: number;
  timeoutResolved: boolean;
};

const ICE_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
];
const PADDLE_X_LEFT = 0.055;
const PADDLE_X_RIGHT = 0.945;
const PADDLE_W = 0.021;
const PADDLE_H = 0.17;
const BALL_R = 0.014;
const BASE_SPEED = 0.68;
const MAX_SPEED = 1.16;
const POINT_PAUSE = 900;
const SCORE_OPTIONS = [3, 5, 7, 10, 15];
const TIME_OPTIONS = [0, 60, 120, 180, 300, 600];

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const clampPaddleY = (y: number) => clamp(y, PADDLE_H / 2 + 0.025, 1 - PADDLE_H / 2 - 0.025);
const timeLabel = (seconds: number) => seconds === 0 ? "Sans limite" : seconds < 60 ? `${seconds}s` : `${seconds / 60} min`;
const formatClock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.max(0, seconds % 60)).padStart(2, "0")}`;

async function post(payload: Record<string, unknown>) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 3500);
  try {
    const response = await fetch("/api/pong", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      cache: "no-store",
      signal: controller.signal,
    });
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.error || "Erreur Pong.");
    return data;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw new Error("Pong met trop de temps à répondre.");
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}

function cloneFrame(frame: Frame): Frame {
  return {
    ball: { ...frame.ball },
    paddles: Object.fromEntries(Object.entries(frame.paddles).map(([id, paddle]) => [id, { ...paddle }])),
    leftScore: frame.leftScore,
    rightScore: frame.rightScore,
    winnerSide: frame.winnerSide,
    pauseUntil: frame.pauseUntil,
    serveDir: frame.serveDir,
  };
}

function makeFrame(players: Player[], leftScore = 0, rightScore = 0): Frame {
  return {
    ball: { x: 0.5, y: 0.5, vx: 0, vy: 0 },
    paddles: Object.fromEntries(players.map((player) => [player.userId, { y: 0.5, vy: 0 }])),
    leftScore,
    rightScore,
    winnerSide: null,
    pauseUntil: Date.now() + 950,
    serveDir: Math.random() < 0.5 ? -1 : 1,
  };
}

function setServe(frame: Frame, concededSide: Side) {
  frame.ball = { x: 0.5, y: 0.5, vx: 0, vy: 0 };
  frame.serveDir = concededSide === "left" ? -1 : 1;
  frame.pauseUntil = Date.now() + POINT_PAUSE;
  for (const paddle of Object.values(frame.paddles)) {
    paddle.y = 0.5;
    paddle.vy = 0;
  }
}

function launchServe(frame: Frame) {
  if (frame.winnerSide || Date.now() < frame.pauseUntil) return;
  if (Math.abs(frame.ball.vx) > 0.001 || Math.abs(frame.ball.vy) > 0.001) return;
  frame.ball.vx = frame.serveDir * BASE_SPEED;
  frame.ball.vy = Math.random() * 0.34 - 0.17;
}

function bounceFromPaddle(frame: Frame, player: Player, paddle: Paddle) {
  const ball = frame.ball;
  const speed = Math.min(MAX_SPEED, Math.max(BASE_SPEED, Math.hypot(ball.vx, ball.vy) * 1.045));
  const offset = clamp((ball.y - paddle.y) / (PADDLE_H / 2), -1, 1);
  const verticalRatio = clamp(offset * 0.72 + paddle.vy * 0.055, -0.78, 0.78);
  const vy = verticalRatio * speed;
  const vxMagnitude = Math.sqrt(Math.max(speed * speed - vy * vy, speed * speed * 0.42));
  ball.vx = player.side === "left" ? Math.abs(vxMagnitude) : -Math.abs(vxMagnitude);
  ball.vy = vy;
}

function stepSimulation(simulation: Simulation, players: Player[], dt: number, targetScore: number, suddenDeath: boolean) {
  const frame = simulation.frame;
  const steps = Math.max(1, Math.min(6, Math.ceil(dt / 0.006)));
  const stepDt = dt / steps;

  for (let step = 0; step < steps; step++) {
    for (const player of players) {
      const paddle = frame.paddles[player.userId] ?? { y: 0.5, vy: 0 };
      const oldY = paddle.y;
      const target = clampPaddleY(simulation.targets[player.userId] ?? paddle.y);
      paddle.y = target;
      paddle.vy = clamp((paddle.y - oldY) / Math.max(stepDt, 0.001), -3.4, 3.4);
      frame.paddles[player.userId] = paddle;
    }

    if (frame.winnerSide) continue;
    launchServe(frame);
    if (Date.now() < frame.pauseUntil) continue;

    const oldX = frame.ball.x;
    const oldY = frame.ball.y;
    frame.ball.x += frame.ball.vx * stepDt;
    frame.ball.y += frame.ball.vy * stepDt;

    if (frame.ball.y - BALL_R <= 0) {
      frame.ball.y = BALL_R;
      frame.ball.vy = Math.abs(frame.ball.vy);
    } else if (frame.ball.y + BALL_R >= 1) {
      frame.ball.y = 1 - BALL_R;
      frame.ball.vy = -Math.abs(frame.ball.vy);
    }

    const left = players.find((player) => player.side === "left");
    const right = players.find((player) => player.side === "right");

    if (left && frame.ball.vx < 0) {
      const face = PADDLE_X_LEFT + PADDLE_W / 2 + BALL_R;
      if (oldX >= face && frame.ball.x <= face) {
        const travel = Math.max(0.000001, oldX - frame.ball.x);
        const t = clamp((oldX - face) / travel, 0, 1);
        const impactY = oldY + (frame.ball.y - oldY) * t;
        const paddle = frame.paddles[left.userId] ?? { y: 0.5, vy: 0 };
        if (Math.abs(impactY - paddle.y) <= PADDLE_H / 2 + BALL_R) {
          frame.ball.x = face;
          frame.ball.y = impactY;
          bounceFromPaddle(frame, left, paddle);
        }
      }
    }

    if (right && frame.ball.vx > 0) {
      const face = PADDLE_X_RIGHT - PADDLE_W / 2 - BALL_R;
      if (oldX <= face && frame.ball.x >= face) {
        const travel = Math.max(0.000001, frame.ball.x - oldX);
        const t = clamp((face - oldX) / travel, 0, 1);
        const impactY = oldY + (frame.ball.y - oldY) * t;
        const paddle = frame.paddles[right.userId] ?? { y: 0.5, vy: 0 };
        if (Math.abs(impactY - paddle.y) <= PADDLE_H / 2 + BALL_R) {
          frame.ball.x = face;
          frame.ball.y = impactY;
          bounceFromPaddle(frame, right, paddle);
        }
      }
    }

    if (frame.ball.x < -BALL_R) {
      frame.rightScore += 1;
      if (frame.rightScore >= targetScore || suddenDeath) {
        frame.winnerSide = "right";
        frame.ball = { x: 0.5, y: 0.5, vx: 0, vy: 0 };
      } else {
        setServe(frame, "left");
        simulation.targets = Object.fromEntries(players.map((player) => [player.userId, 0.5]));
      }
    } else if (frame.ball.x > 1 + BALL_R) {
      frame.leftScore += 1;
      if (frame.leftScore >= targetScore || suddenDeath) {
        frame.winnerSide = "left";
        frame.ball = { x: 0.5, y: 0.5, vx: 0, vy: 0 };
      } else {
        setServe(frame, "right");
        simulation.targets = Object.fromEntries(players.map((player) => [player.userId, 0.5]));
      }
    }
  }
}

function predictBall(ball: Ball, ageSeconds: number) {
  const dt = Math.min(ageSeconds, 0.11);
  let x = ball.x + ball.vx * dt;
  let y = ball.y + ball.vy * dt;
  let vy = ball.vy;
  if (y < BALL_R) { y = BALL_R + (BALL_R - y); vy = Math.abs(vy); }
  else if (y > 1 - BALL_R) { y = (1 - BALL_R) - (y - (1 - BALL_R)); vy = -Math.abs(vy); }
  return { ...ball, x, y, vy };
}

function updatePongBot(simulation: Simulation, game: Game, now: number) {
  const bot = game.players.find((player) => player.isBot);
  if (!bot) return;
  const paddle = simulation.frame.paddles[bot.userId] ?? { y: 0.5, vy: 0 };
  const difficulty = bot.difficulty ?? "normal";
  const speed = difficulty === "easy" ? 0.48 : difficulty === "hard" ? 1.04 : 0.72;
  const error = difficulty === "easy" ? 0.105 : difficulty === "hard" ? 0.025 : 0.055;
  const ball = simulation.frame.ball;
  const movingTowardBot = bot.side === "right" ? ball.vx > 0 : ball.vx < 0;
  const wobble = Math.sin(now / 360 + simulation.frame.leftScore * 1.4) * error;
  const desired = movingTowardBot ? clampPaddleY(ball.y + wobble) : 0.5;
  const dt = clamp((now - simulation.lastTs) / 1000, 0.008, 0.032);
  const delta = clamp(desired - paddle.y, -speed * dt, speed * dt);
  simulation.targets[bot.userId] = clampPaddleY(paddle.y + delta);
}

export default function PongGame({ room, user }: { room: Room; user: User }) {
  const [game, setGame] = useState<Game | null>(null);
  const [frame, setFrame] = useState<Frame | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [botDifficulty, setBotDifficulty] = useState<BotDifficulty>("normal");
  const [clock, setClock] = useState(Date.now());

  const gameRef = useRef<Game | null>(null);
  const simulationRef = useRef<Simulation | null>(null);
  const courtRef = useRef<HTMLDivElement | null>(null);
  const peersRef = useRef<Map<string, PeerEntry>>(new Map());
  const pendingIceRef = useRef<Map<string, RTCIceCandidateInit[]>>(new Map());
  const signalCursorRef = useRef(0);
  const reconnectingRef = useRef<Set<string>>(new Set());
  const draggingRef = useRef(false);
  const localYRef = useRef(0.5);
  const remoteSnapshotRef = useRef<{ frame: Frame; receivedAt: number } | null>(null);
  const lastDirectInputRef = useRef(0);
  const lastFallbackInputRef = useRef(0);
  const keysRef = useRef({ up: false, down: false });

  useEffect(() => { gameRef.current = game; }, [game]);
  useEffect(() => {
    if (!game || game.status === "lobby" || !game.endsAt) return;
    const id = window.setInterval(() => setClock(Date.now()), 200);
    return () => window.clearInterval(id);
  }, [game?.status, game?.endsAt]);

  const isHost = room.hostId === user.id;
  const me = useMemo(() => game?.players.find((player) => player.userId === user.id) ?? null, [game, user.id]);
  const online = room.members.filter((member) => member.online).length;
  const rosterKey = useMemo(() => game?.players.map((player) => player.userId).join(",") ?? "", [game?.players]);

  const sendSignal = useCallback(async (targetId: string, kind: Signal["kind"], payload: unknown) => {
    await post({ action: "signal", code: room.code, targetId, kind, payload });
  }, [room.code]);

  const closePeer = useCallback((peerId: string) => {
    const entry = peersRef.current.get(peerId);
    if (entry) {
      try { entry.dc?.close(); } catch {}
      try { entry.pc.close(); } catch {}
      peersRef.current.delete(peerId);
    }
    reconnectingRef.current.delete(peerId);
  }, []);

  const closeAllPeers = useCallback(() => {
    for (const peerId of [...peersRef.current.keys()]) closePeer(peerId);
    pendingIceRef.current.clear();
    reconnectingRef.current.clear();
  }, [closePeer]);

  const flushIce = useCallback(async (peerId: string, pc: RTCPeerConnection) => {
    if (!pc.remoteDescription) return;
    const queue = pendingIceRef.current.get(peerId) ?? [];
    pendingIceRef.current.set(peerId, []);
    for (const candidate of queue) {
      try { await pc.addIceCandidate(candidate); } catch {}
    }
  }, []);

  const receiveInput = useCallback((senderId: string, payload: unknown) => {
    const current = gameRef.current;
    const simulation = simulationRef.current;
    if (!current || !simulation || room.hostId !== user.id || !payload || typeof payload !== "object") return;
    const player = current.players.find((entry) => entry.userId === senderId);
    if (!player) return;
    const y = Number((payload as { y?: unknown }).y);
    if (Number.isFinite(y)) simulation.targets[senderId] = clampPaddleY(y);
  }, [room.hostId, user.id]);

  const receiveState = useCallback((payload: unknown) => {
    if (!payload || typeof payload !== "object") return;
    const incoming = payload as Frame;
    if (!incoming.ball || !incoming.paddles) return;
    const copy = cloneFrame(incoming);
    remoteSnapshotRef.current = { frame: copy, receivedAt: performance.now() };
    if (!isHost) setFrame(copy);
  }, [isHost]);

  const attachDataChannel = useCallback((peerId: string, channel: RTCDataChannel, hostSide: boolean) => {
    const entry = peersRef.current.get(peerId);
    if (entry) entry.dc = channel;
    channel.onopen = () => {
      reconnectingRef.current.delete(peerId);
      if (hostSide && simulationRef.current && channel.readyState === "open") {
        try { channel.send(JSON.stringify({ type: "state", state: simulationRef.current.frame })); } catch {}
      }
    };
    channel.onmessage = (event) => {
      try {
        const message = JSON.parse(String(event.data));
        if (hostSide && message.type === "input") receiveInput(peerId, message.input);
        else if (!hostSide && message.type === "state") receiveState(message.state);
      } catch {}
    };
    channel.onclose = () => closePeer(peerId);
  }, [closePeer, receiveInput, receiveState]);

  const makePeer = useCallback((peerId: string, hostSide: boolean) => {
    const old = peersRef.current.get(peerId);
    if (old && old.pc.connectionState !== "failed" && old.pc.connectionState !== "closed") return old;
    if (old) closePeer(peerId);
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    const entry: PeerEntry = { pc, dc: null };
    peersRef.current.set(peerId, entry);
    pc.onicecandidate = (event) => {
      if (event.candidate) void sendSignal(peerId, "ice", event.candidate.toJSON()).catch(() => undefined);
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "failed" || pc.connectionState === "closed") closePeer(peerId);
      if (pc.connectionState === "disconnected") window.setTimeout(() => {
        if (pc.connectionState === "disconnected") closePeer(peerId);
      }, 900);
    };
    if (!hostSide) pc.ondatachannel = (event) => attachDataChannel(peerId, event.channel, false);
    return entry;
  }, [attachDataChannel, closePeer, sendSignal]);

  const startHostPeer = useCallback(async (peerId: string) => {
    if (peerId === user.id || reconnectingRef.current.has(peerId)) return;
    const old = peersRef.current.get(peerId);
    if (old?.dc?.readyState === "open" || old?.pc.connectionState === "connecting") return;
    reconnectingRef.current.add(peerId);
    try {
      if (old) closePeer(peerId);
      const entry = makePeer(peerId, true);
      const channel = entry.pc.createDataChannel("retro-pong");
      entry.dc = channel;
      attachDataChannel(peerId, channel, true);
      const offer = await entry.pc.createOffer();
      await entry.pc.setLocalDescription(offer);
      await sendSignal(peerId, "offer", offer);
    } catch { closePeer(peerId); }
    finally { window.setTimeout(() => reconnectingRef.current.delete(peerId), 600); }
  }, [attachDataChannel, closePeer, makePeer, sendSignal, user.id]);

  const handleSignal = useCallback(async (signal: Signal) => {
    const current = gameRef.current;
    if (!current || current.status === "lobby") return;
    const hostId = room.hostId;
    if (signal.kind === "input") {
      if (user.id === hostId) receiveInput(signal.senderId, signal.payload);
      return;
    }
    if (signal.kind === "state") {
      if (user.id !== hostId && signal.senderId === hostId) receiveState(signal.payload);
      return;
    }
    if (user.id === hostId) {
      const entry = peersRef.current.get(signal.senderId);
      if (signal.kind === "answer" && entry) {
        try { await entry.pc.setRemoteDescription(signal.payload as RTCSessionDescriptionInit); await flushIce(signal.senderId, entry.pc); }
        catch { closePeer(signal.senderId); }
      } else if (signal.kind === "ice") {
        const candidate = signal.payload as RTCIceCandidateInit;
        if (entry?.pc.remoteDescription) { try { await entry.pc.addIceCandidate(candidate); } catch {} }
        else { const queue = pendingIceRef.current.get(signal.senderId) ?? []; queue.push(candidate); pendingIceRef.current.set(signal.senderId, queue); }
      }
      return;
    }
    if (signal.senderId !== hostId) return;
    if (signal.kind === "offer") {
      try {
        closePeer(hostId);
        const entry = makePeer(hostId, false);
        await entry.pc.setRemoteDescription(signal.payload as RTCSessionDescriptionInit);
        await flushIce(hostId, entry.pc);
        const answer = await entry.pc.createAnswer();
        await entry.pc.setLocalDescription(answer);
        await sendSignal(hostId, "answer", answer);
      } catch { closePeer(hostId); }
    } else if (signal.kind === "ice") {
      const entry = peersRef.current.get(hostId);
      const candidate = signal.payload as RTCIceCandidateInit;
      if (entry?.pc.remoteDescription) { try { await entry.pc.addIceCandidate(candidate); } catch {} }
      else { const queue = pendingIceRef.current.get(hostId) ?? []; queue.push(candidate); pendingIceRef.current.set(hostId, queue); }
    }
  }, [closePeer, flushIce, makePeer, receiveInput, receiveState, room.hostId, sendSignal, user.id]);

  useEffect(() => {
    let alive = true;
    let timer: number | undefined;
    const pollState = async () => {
      try {
        const data = await post({ action: "state", code: room.code });
        if (!alive) return;
        const next = data.game as Game;
        gameRef.current = next;
        setGame(next);
        setError("");
        timer = window.setTimeout(() => void pollState(), next.status === "lobby" ? 360 : 1200);
      } catch (pollError) {
        if (!alive) return;
        setError(pollError instanceof Error ? pollError.message : "Pong indisponible.");
        timer = window.setTimeout(() => void pollState(), 1000);
      }
    };
    void pollState();
    return () => { alive = false; if (timer !== undefined) window.clearTimeout(timer); };
  }, [room.code]);

  useEffect(() => {
    const active = game?.status === "playing" || game?.status === "gameover";
    document.body.classList.toggle("pong-match-active", Boolean(active));
    return () => document.body.classList.remove("pong-match-active");
  }, [game?.status]);

  useEffect(() => {
    if (!game || game.status === "lobby") {
      closeAllPeers();
      simulationRef.current = null;
      remoteSnapshotRef.current = null;
      signalCursorRef.current = 0;
      localYRef.current = 0.5;
      setFrame(null);
      return;
    }
    signalCursorRef.current = 0;
    localYRef.current = 0.5;
    if (isHost) {
      const initial = makeFrame(game.players, game.leftScore, game.rightScore);
      simulationRef.current = {
        frame: initial,
        targets: Object.fromEntries(game.players.map((player) => [player.userId, 0.5])),
        lastTs: performance.now(),
        lastBroadcast: 0,
        lastFallbackBroadcast: 0,
        lastCheckpointLeft: game.leftScore,
        lastCheckpointRight: game.rightScore,
        timeoutResolved: false,
      };
      setFrame(cloneFrame(initial));
    } else setFrame(makeFrame(game.players, game.leftScore, game.rightScore));
  }, [closeAllPeers, game?.status, isHost, rosterKey]);

  useEffect(() => () => closeAllPeers(), [closeAllPeers]);

  useEffect(() => {
    if (!game || game.status === "lobby") return;
    let alive = true;
    let timer: number | undefined;
    const signalPoll = async () => {
      if (!alive) return;
      try {
        const data = await post({ action: "poll", code: room.code, after: signalCursorRef.current });
        if (!alive) return;
        signalCursorRef.current = Number(data.cursor ?? signalCursorRef.current);
        for (const signal of (data.signals ?? []) as Signal[]) await handleSignal(signal);
      } catch {}
      const peer = peersRef.current.get(isHost ? (gameRef.current?.players.find((p) => p.userId !== user.id && !p.isBot)?.userId ?? "") : room.hostId);
      timer = window.setTimeout(() => void signalPoll(), peer?.dc?.readyState === "open" ? 700 : 90);
    };
    void signalPoll();
    return () => { alive = false; if (timer !== undefined) window.clearTimeout(timer); };
  }, [game?.status, handleSignal, isHost, room.code, room.hostId, user.id]);

  useEffect(() => {
    if (!game || game.status !== "playing" || !isHost) return;
    const ensure = () => {
      const other = gameRef.current?.players.find((player) => player.userId !== user.id && !player.isBot);
      if (other) void startHostPeer(other.userId);
    };
    ensure();
    const id = window.setInterval(ensure, 900);
    return () => window.clearInterval(id);
  }, [game?.status, isHost, startHostPeer, user.id]);

  const checkpoint = useCallback((leftScore: number, rightScore: number, winnerSide?: Side | null) => {
    void post({ action: "checkpoint", code: room.code, leftScore, rightScore, winnerSide: winnerSide ?? null }).catch(() => undefined);
  }, [room.code]);

  useEffect(() => {
    if (!game || game.status === "lobby" || !isHost) return;
    let raf = 0;
    const tick = (now: number) => {
      const current = gameRef.current;
      const simulation = simulationRef.current;
      if (!current || !simulation || current.status === "lobby") return;

      const own = current.players.find((player) => player.userId === user.id);
      if (own) simulation.targets[user.id] = localYRef.current;
      updatePongBot(simulation, current, now);

      let suddenDeath = false;
      if (!simulation.frame.winnerSide && current.endsAt && Date.now() >= current.endsAt) {
        if (simulation.frame.leftScore !== simulation.frame.rightScore) {
          simulation.frame.winnerSide = simulation.frame.leftScore > simulation.frame.rightScore ? "left" : "right";
          if (!simulation.timeoutResolved) {
            simulation.timeoutResolved = true;
            checkpoint(simulation.frame.leftScore, simulation.frame.rightScore, simulation.frame.winnerSide);
          }
        } else {
          suddenDeath = true;
        }
      }

      const dt = clamp((now - simulation.lastTs) / 1000, 0.001, 0.032);
      simulation.lastTs = now;
      stepSimulation(simulation, current.players, dt, current.targetScore, suddenDeath);
      setFrame(cloneFrame(simulation.frame));

      if (simulation.frame.leftScore !== simulation.lastCheckpointLeft || simulation.frame.rightScore !== simulation.lastCheckpointRight) {
        simulation.lastCheckpointLeft = simulation.frame.leftScore;
        simulation.lastCheckpointRight = simulation.frame.rightScore;
        localYRef.current = 0.5;
        checkpoint(simulation.frame.leftScore, simulation.frame.rightScore, simulation.frame.winnerSide);
      }

      if (now - simulation.lastBroadcast >= 33) {
        simulation.lastBroadcast = now;
        const message = JSON.stringify({ type: "state", state: simulation.frame });
        for (const player of current.players) {
          if (player.userId === user.id || player.isBot) continue;
          const channel = peersRef.current.get(player.userId)?.dc;
          if (channel?.readyState === "open") { try { channel.send(message); } catch {} }
        }
      }
      if (now - simulation.lastFallbackBroadcast >= 170) {
        simulation.lastFallbackBroadcast = now;
        for (const player of current.players) {
          if (player.userId === user.id || player.isBot) continue;
          if (peersRef.current.get(player.userId)?.dc?.readyState !== "open") void sendSignal(player.userId, "state", simulation.frame).catch(() => undefined);
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [checkpoint, game?.status, isHost, sendSignal, user.id]);

  useEffect(() => {
    if (!game || game.status === "lobby" || isHost) return;
    let raf = 0;
    const draw = (now: number) => {
      const snapshot = remoteSnapshotRef.current;
      const current = gameRef.current;
      if (snapshot && current) {
        const next = cloneFrame(snapshot.frame);
        if (!next.winnerSide && Date.now() >= next.pauseUntil) next.ball = predictBall(next.ball, (now - snapshot.receivedAt) / 1000);
        const own = current.players.find((player) => player.userId === user.id);
        if (own) next.paddles[own.userId] = { ...(next.paddles[own.userId] ?? { y: 0.5, vy: 0 }), y: localYRef.current };
        setFrame(next);
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [game?.status, isHost, user.id]);

  const sendInput = useCallback((force = false) => {
    if (isHost) return;
    const now = performance.now();
    const channel = peersRef.current.get(room.hostId)?.dc;
    if (channel?.readyState === "open") {
      if (force || now - lastDirectInputRef.current >= 12) {
        lastDirectInputRef.current = now;
        try { channel.send(JSON.stringify({ type: "input", input: { y: localYRef.current } })); } catch {}
      }
      return;
    }
    if (force || now - lastFallbackInputRef.current >= 85) {
      lastFallbackInputRef.current = now;
      void sendSignal(room.hostId, "input", { y: localYRef.current }).catch(() => undefined);
    }
  }, [isHost, room.hostId, sendSignal]);

  const movePaddle = useCallback((y: number) => {
    if (!gameRef.current || gameRef.current.status !== "playing" || !me) return;
    localYRef.current = clampPaddleY(y);
    if (isHost && simulationRef.current) simulationRef.current.targets[user.id] = localYRef.current;
    else sendInput();
  }, [isHost, me, sendInput, user.id]);

  const pointerY = (event: PointerEvent<HTMLDivElement>) => {
    const rect = courtRef.current?.getBoundingClientRect();
    if (rect) movePaddle((event.clientY - rect.top) / rect.height);
  };
  const pointerDown = (event: PointerEvent<HTMLDivElement>) => {
    draggingRef.current = true;
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch {}
    pointerY(event);
  };
  const pointerMove = (event: PointerEvent<HTMLDivElement>) => { if (draggingRef.current) pointerY(event); };
  const pointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (draggingRef.current) pointerY(event);
    draggingRef.current = false;
    if (!isHost) sendInput(true);
    try { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); } catch {}
  };

  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (!["ArrowUp", "ArrowDown", "w", "W", "s", "S"].includes(event.key)) return;
      event.preventDefault();
      if (["ArrowUp", "w", "W"].includes(event.key)) keysRef.current.up = true;
      if (["ArrowDown", "s", "S"].includes(event.key)) keysRef.current.down = true;
    };
    const up = (event: KeyboardEvent) => {
      if (["ArrowUp", "w", "W"].includes(event.key)) keysRef.current.up = false;
      if (["ArrowDown", "s", "S"].includes(event.key)) keysRef.current.down = false;
    };
    window.addEventListener("keydown", down, { passive: false });
    window.addEventListener("keyup", up);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); };
  }, []);

  useEffect(() => {
    if (!game || game.status !== "playing" || !me) return;
    let raf = 0;
    let last = performance.now();
    const keysTick = (now: number) => {
      const dt = Math.min(0.04, (now - last) / 1000);
      last = now;
      const direction = (keysRef.current.down ? 1 : 0) - (keysRef.current.up ? 1 : 0);
      if (direction) movePaddle(localYRef.current + direction * dt * 0.92);
      raf = requestAnimationFrame(keysTick);
    };
    raf = requestAnimationFrame(keysTick);
    return () => cancelAnimationFrame(raf);
  }, [game?.status, me, movePaddle]);

  useEffect(() => {
    if (!game || game.status !== "playing" || isHost) return;
    const id = window.setInterval(() => {
      if (draggingRef.current || keysRef.current.up || keysRef.current.down) sendInput(true);
    }, 28);
    return () => window.clearInterval(id);
  }, [game?.status, isHost, sendInput]);

  const configure = async (targetScore: number, timeLimitSec: number) => {
    try {
      setBusy(true); setError("");
      const data = await post({ action: "configure", code: room.code, targetScore, timeLimitSec });
      gameRef.current = data.game as Game;
      setGame(data.game as Game);
    } catch (actionError) { setError(actionError instanceof Error ? actionError.message : "Impossible de régler Pong."); }
    finally { setBusy(false); }
  };

  const start = async (withBot = false) => {
    try {
      setBusy(true); setError(""); closeAllPeers(); signalCursorRef.current = 0;
      const data = await post({ action: "start", code: room.code, botDifficulty: withBot ? botDifficulty : null });
      gameRef.current = data.game as Game;
      setGame(data.game as Game);
      setClock(Date.now());
    } catch (startError) { setError(startError instanceof Error ? startError.message : "Impossible de lancer Pong."); }
    finally { setBusy(false); }
  };

  if (!game) return <section className="pongLobby"><div className="spinner"/><p>Chargement de Pong…</p>{error && <div className="errorBox">{error}</div>}</section>;

  if (game.status === "lobby") {
    return <section className="pongLobby pongLobbyWithSettings">
      <div className="pongLobbyIcon"><span className="pongIconPaddle"/><i/><span className="pongIconPaddle"/></div>
      <div className="pongLobbyCopy">
        <span className="kicker">CLASSIQUE · 2 JOUEURS</span><h2>Pong</h2>
        <p>Le Pong original : deux raquettes, une balle carrée et un duel en 1 contre 1.</p>
        <div className="pongSettings">
          <label><small>Points pour gagner</small><select value={game.targetScore} disabled={!isHost || busy} onChange={(event) => void configure(Number(event.target.value), game.timeLimitSec)}>{SCORE_OPTIONS.map((score) => <option key={score} value={score}>{score} points</option>)}</select></label>
          <label><small>Temps imparti</small><select value={game.timeLimitSec} disabled={!isHost || busy} onChange={(event) => void configure(game.targetScore, Number(event.target.value))}>{TIME_OPTIONS.map((seconds) => <option key={seconds} value={seconds}>{timeLabel(seconds)}</option>)}</select></label>
        </div>
      </div>
      <div className="pongReady">
        <span>{online}/2 joueurs connectés</span>
        {isHost ? <button className="primaryButton" disabled={busy || online !== 2} onClick={() => void start(false)}>{busy ? "Lancement…" : "Lancer Pong"}</button> : <small>En attente de l'hôte…</small>}
      </div>
      {isHost && online === 1 && <div className="botPlayPanel"><div><strong>🤖 Jouer contre un bot</strong><small>Pas besoin d'attendre un ami.</small></div><select value={botDifficulty} onChange={(event) => setBotDifficulty(event.target.value as BotDifficulty)}><option value="easy">Facile</option><option value="normal">Normal</option><option value="hard">Difficile</option></select><button disabled={busy} onClick={() => void start(true)}>Lancer vs BOT</button></div>}
      {error && <div className="errorBox">{error}</div>}
    </section>;
  }

  const shown = frame ?? makeFrame(game.players, game.leftScore, game.rightScore);
  const left = game.players.find((player) => player.side === "left");
  const right = game.players.find((player) => player.side === "right");
  const leftPaddle = left ? shown.paddles[left.userId] ?? { y: 0.5, vy: 0 } : { y: 0.5, vy: 0 };
  const rightPaddle = right ? shown.paddles[right.userId] ?? { y: 0.5, vy: 0 } : { y: 0.5, vy: 0 };
  const winner = shown.winnerSide === "left" ? left?.username : shown.winnerSide === "right" ? right?.username : "";
  const remaining = game.endsAt ? Math.max(0, Math.ceil((game.endsAt - clock) / 1000)) : null;
  const suddenDeath = remaining === 0 && !shown.winnerSide && shown.leftScore === shown.rightScore;

  return <section className="pongGameWrap">
    <div className="pongMatchMeta"><span>Premier à {game.targetScore}</span>{remaining !== null && <strong className={suddenDeath ? "sudden" : ""}>{suddenDeath ? "MORT SUBITE" : formatClock(remaining)}</strong>}</div>
    <div ref={courtRef} className={`pongCourt ${me ? "controllable" : "spectating"}`} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={pointerUp} onLostPointerCapture={() => { draggingRef.current = false; }}>
      <div className="pongCenterLine"/>
      <div className="pongScore"><b>{shown.leftScore}</b><b>{shown.rightScore}</b></div>
      <div className="pongPaddle pongPaddleLeft" style={{ top: `${leftPaddle.y * 100}%` }}/>
      <div className="pongPaddle pongPaddleRight" style={{ top: `${rightPaddle.y * 100}%` }}/>
      <div className="pongBall" style={{ left: `${shown.ball.x * 100}%`, top: `${shown.ball.y * 100}%` }}/>
      {shown.winnerSide && <div className="pongWinner"><strong>{winner || "Joueur"} gagne</strong><span>{shown.leftScore} — {shown.rightScore}</span>{isHost && <button onClick={() => void start(Boolean(game.players.some((player) => player.isBot)))}>Rejouer</button>}</div>}
    </div>
    <div className="pongControlsHint">Glisse verticalement · clavier : ↑ ↓ ou W S</div>
    {error && <div className="errorBox">{error}</div>}
  </section>;
}
