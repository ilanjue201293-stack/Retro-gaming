"use client";

import { ChangeEvent, PointerEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

type User = { id: string; username: string; avatarData?: string | null };
type RoomMember = { id: string; username: string; online: boolean; joined_at: string };
type Room = { code: string; hostId: string; members: RoomMember[] };
type Mode = "1v1" | "2v1" | "2v2";
type BotDifficulty = "easy" | "normal" | "hard";
type Side = "left" | "right";
type Player = { userId: string; username: string; avatarData?: string | null; side: Side; slot: number; isBot?: boolean; difficulty?: BotDifficulty };
type Paddle = { x: number; y: number; vx: number; vy: number };
type Puck = { x: number; y: number; vx: number; vy: number };
type Frame = { puck: Puck; paddles: Record<string, Paddle>; leftScore: number; rightScore: number; winnerSide: Side | null; pauseUntil: number };
type Game = {
  mode: Mode;
  status: "lobby" | "playing" | "gameover";
  players: Player[];
  leftScore: number;
  rightScore: number;
  winnerSide: Side | null;
  targetScore: number;
  timeLimitSec: number;
  startedAt: number | null;
  endsAt: number | null;
  frame?: Frame | null;
};
type InputPacket = { x: number; y: number; vx: number; vy: number };
type Signal = { id: number; senderId: string; kind: "offer" | "answer" | "ice" | "input" | "state"; payload: unknown };
type PeerEntry = { pc: RTCPeerConnection; dc: RTCDataChannel | null };
type Simulation = {
  key: string;
  frame: Frame;
  targets: Record<string, Paddle>;
  lastTs: number;
  lastBroadcast: number;
  lastFallbackBroadcast: number;
  lastCheckpointLeft: number;
  lastCheckpointRight: number;
  timeoutResolved: boolean;
  botStates?: Record<string, { phase: "setup" | "strike" | "recover"; until: number; aimY: number }>;
};

const ICE_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
  { urls: "stun:stun.relay.metered.ca:80" },
  { urls: "turn:global.relay.metered.ca:80", username: "openrelayproject", credential: "openrelayproject" },
  { urls: "turn:global.relay.metered.ca:80?transport=tcp", username: "openrelayproject", credential: "openrelayproject" },
  { urls: "turns:global.relay.metered.ca:443?transport=tcp", username: "openrelayproject", credential: "openrelayproject" },
];
const PUCK_R = 0.024;
const MALLET_R = 0.048;
const CONTACT_SEPARATION = 0.0012;
const LEFT_BOARD = 0.03;
const RIGHT_BOARD = 0.97;
const TOP_BOARD = 0.045;
const BOTTOM_BOARD = 0.955;
const GOAL_MIN = 0.33;
const GOAL_MAX = 0.67;
const MAX_PUCK_SPEED = 1.45;
const MAX_MALLET_SPEED = 1.85;
const INTERNAL_MAX_SCORE = 30;
const INITIAL_COUNTDOWN_MS = 5000;
const FACEOFF_MS = 3000;
const SCORE_OPTIONS = [3, 5, 7, 10, 15];
const TIME_OPTIONS = [0, 60, 120, 180, 300, 600];

const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
const timeLabel = (seconds: number) => seconds === 0 ? "Sans limite" : `${seconds / 60} min`;
const formatClock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.max(0, seconds % 60)).padStart(2, "0")}`;
function teamCaps(mode: Mode, twoPlayerSide: Side) {
  if (mode === "1v1") return { left: 1, right: 1 };
  if (mode === "2v2") return { left: 2, right: 2 };
  return twoPlayerSide === "left" ? { left: 2, right: 1 } : { left: 1, right: 2 };
}

async function post(payload: Record<string, unknown>) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch("/api/rooms", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload), cache: "no-store", signal: controller.signal });
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.error || "Erreur.");
    return data;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw new Error("Le réseau du hockey met trop de temps à répondre.");
    throw error;
  } finally { window.clearTimeout(timeout); }
}

async function postAuth(payload: Record<string, unknown>) {
  const response = await fetch("/api/auth", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload), cache: "no-store" });
  const data = await response.json();
  if (!response.ok || !data.ok) throw new Error(data.error || "Erreur.");
  return data;
}

function compressAvatar(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) return Promise.reject(new Error("Choisis une image."));
  if (file.size > 8_000_000) return Promise.reject(new Error("Image trop lourde (8 Mo max)."));
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      try {
        const size = 192;
        const canvas = document.createElement("canvas");
        canvas.width = size; canvas.height = size;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("Impossible de préparer l'image.");
        const sourceSize = Math.min(image.naturalWidth, image.naturalHeight);
        const sx = (image.naturalWidth - sourceSize) / 2;
        const sy = (image.naturalHeight - sourceSize) / 2;
        context.drawImage(image, sx, sy, sourceSize, sourceSize, 0, 0, size, size);
        let result = canvas.toDataURL("image/jpeg", 0.82);
        if (result.length > 210_000) result = canvas.toDataURL("image/jpeg", 0.65);
        URL.revokeObjectURL(url); resolve(result);
      } catch (error) { URL.revokeObjectURL(url); reject(error); }
    };
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Impossible de lire cette image.")); };
    image.src = url;
  });
}

function initialPaddle(player: Player, mode: Mode): Paddle {
  return { x: player.side === "left" ? 0.2 : 0.8, y: player.slot < 0 ? 0.5 : player.slot === 0 ? 0.34 : 0.66, vx: 0, vy: 0 };
}
function clampPaddle(side: Side, x: number, y: number) {
  return { x: clamp(x, side === "left" ? 0.075 : 0.53, side === "left" ? 0.47 : 0.925), y: clamp(y, 0.085, 0.915) };
}
function capVelocity(x: number, y: number, max: number) {
  const speed = Math.hypot(x, y);
  if (!Number.isFinite(speed) || speed < 0.000001) return { x: 0, y: 0 };
  if (speed <= max) return { x, y };
  const factor = max / speed;
  return { x: x * factor, y: y * factor };
}
function cloneFrame(frame: Frame): Frame {
  return { puck: { ...frame.puck }, paddles: Object.fromEntries(Object.entries(frame.paddles).map(([id, paddle]) => [id, { ...paddle }])), leftScore: frame.leftScore, rightScore: frame.rightScore, winnerSide: frame.winnerSide, pauseUntil: frame.pauseUntil };
}
function makeFrame(players: Player[], mode: Mode, leftScore = 0, rightScore = 0, pauseUntil = Date.now()): Frame {
  return { puck: { x: 0.5, y: 0.5, vx: 0, vy: 0 }, paddles: Object.fromEntries(players.map((player) => [player.userId, initialPaddle(player, mode)])), leftScore, rightScore, winnerSide: null, pauseUntil };
}
function resetFaceoff(simulation: Simulation, players: Player[], mode: Mode, concededSide: Side) {
  const paddles = Object.fromEntries(players.map((player) => [player.userId, initialPaddle(player, mode)]));
  simulation.frame.paddles = paddles;
  simulation.targets = Object.fromEntries(players.map((player) => [player.userId, initialPaddle(player, mode)]));
  simulation.frame.puck = { x: concededSide === "left" ? 0.34 : 0.66, y: 0.5, vx: 0, vy: 0 };
  simulation.frame.pauseUntil = Date.now() + FACEOFF_MS;
}

function collidePuckWithPaddle(frame: Frame, oldPuck: Puck, oldPaddle: Paddle, paddle: Paddle, side: Side, stepDt: number) {
  const radius = PUCK_R + MALLET_R;
  const puckDx = frame.puck.x - oldPuck.x, puckDy = frame.puck.y - oldPuck.y;
  const paddleDx = paddle.x - oldPaddle.x, paddleDy = paddle.y - oldPaddle.y;
  const r0x = oldPuck.x - oldPaddle.x, r0y = oldPuck.y - oldPaddle.y;
  const relDx = puckDx - paddleDx, relDy = puckDy - paddleDy;
  let hitT: number | null = null;
  const startSquared = r0x * r0x + r0y * r0y, radiusSquared = radius * radius;
  if (startSquared <= radiusSquared) hitT = 0;
  else {
    const a = relDx * relDx + relDy * relDy;
    const b = 2 * (r0x * relDx + r0y * relDy);
    const c = startSquared - radiusSquared;
    if (a > 0.000000001) {
      const discriminant = b * b - 4 * a * c;
      if (discriminant >= 0) {
        const root = Math.sqrt(discriminant);
        const t1 = (-b - root) / (2 * a), t2 = (-b + root) / (2 * a);
        if (t1 >= 0 && t1 <= 1) hitT = t1; else if (t2 >= 0 && t2 <= 1) hitT = t2;
      }
    }
  }
  if (hitT === null) {
    const endDx = frame.puck.x - paddle.x, endDy = frame.puck.y - paddle.y;
    if (endDx * endDx + endDy * endDy > radiusSquared) return;
    hitT = 1;
  }
  const paddleHitX = oldPaddle.x + paddleDx * hitT, paddleHitY = oldPaddle.y + paddleDy * hitT;
  const puckHitX = oldPuck.x + puckDx * hitT, puckHitY = oldPuck.y + puckDy * hitT;
  let nx = puckHitX - paddleHitX, ny = puckHitY - paddleHitY, normalLength = Math.hypot(nx, ny);
  if (normalLength < 0.0001) { nx = side === "left" ? 1 : -1; ny = 0; normalLength = 1; }
  nx /= normalLength; ny /= normalLength;
  const puckNormal = frame.puck.vx * nx + frame.puck.vy * ny;
  const paddleNormal = paddle.vx * nx + paddle.vy * ny;
  const closingSpeed = paddleNormal - puckNormal;
  const separation = radius + CONTACT_SEPARATION;
  frame.puck.x = paddleHitX + nx * separation; frame.puck.y = paddleHitY + ny * separation;
  if (closingSpeed > 0.0005) {
    const restitution = 0.9;
    const outgoingNormal = (1 + restitution) * paddleNormal - restitution * puckNormal;
    const puckTangentX = frame.puck.vx - puckNormal * nx, puckTangentY = frame.puck.vy - puckNormal * ny;
    const paddleTangentX = paddle.vx - paddleNormal * nx, paddleTangentY = paddle.vy - paddleNormal * ny;
    frame.puck.vx = puckTangentX + outgoingNormal * nx + paddleTangentX * 0.06;
    frame.puck.vy = puckTangentY + outgoingNormal * ny + paddleTangentY * 0.06;
  }
  const velocity = capVelocity(frame.puck.vx, frame.puck.vy, MAX_PUCK_SPEED);
  frame.puck.vx = velocity.x; frame.puck.vy = velocity.y;
  const remainingTime = Math.max(0, 1 - hitT) * stepDt;
  frame.puck.x += frame.puck.vx * remainingTime; frame.puck.y += frame.puck.vy * remainingTime;
  const finalDx = frame.puck.x - paddle.x, finalDy = frame.puck.y - paddle.y, finalDistance = Math.hypot(finalDx, finalDy);
  if (finalDistance < separation) {
    let finalNx = finalDx, finalNy = finalDy, length = finalDistance;
    if (length < 0.0001) { finalNx = nx; finalNy = ny; length = 1; }
    frame.puck.x = paddle.x + (finalNx / length) * separation;
    frame.puck.y = paddle.y + (finalNy / length) * separation;
  }
}

function stepSimulation(simulation: Simulation, players: Player[], mode: Mode, dt: number) {
  const frame = simulation.frame;
  const steps = Math.max(1, Math.min(10, Math.ceil(dt / 0.0045)));
  const stepDt = dt / steps;
  for (let step = 0; step < steps; step++) {
    const remaining = Math.max(1, steps - step);
    const paused = Date.now() < frame.pauseUntil;
    const oldPaddles: Record<string, Paddle> = {};
    for (const player of players) {
      const paddle = frame.paddles[player.userId] ?? initialPaddle(player, mode);
      oldPaddles[player.userId] = { ...paddle };
      if (paused) {
        const start = initialPaddle(player, mode);
        frame.paddles[player.userId] = { ...start };
        simulation.targets[player.userId] = { ...start };
        continue;
      }
      const target = simulation.targets[player.userId] ?? paddle;
      const nextX = paddle.x + (target.x - paddle.x) / remaining, nextY = paddle.y + (target.y - paddle.y) / remaining;
      const velocity = capVelocity((nextX - paddle.x) / Math.max(stepDt, 0.001), (nextY - paddle.y) / Math.max(stepDt, 0.001), MAX_MALLET_SPEED);
      paddle.x = nextX; paddle.y = nextY; paddle.vx = velocity.x; paddle.vy = velocity.y; frame.paddles[player.userId] = paddle;
    }
    if (frame.winnerSide || paused) continue;
    const oldPuck = { ...frame.puck };
    frame.puck.x += frame.puck.vx * stepDt; frame.puck.y += frame.puck.vy * stepDt;
    const friction = Math.pow(0.994, stepDt * 60); frame.puck.vx *= friction; frame.puck.vy *= friction;
    if (frame.puck.y - PUCK_R < TOP_BOARD) { frame.puck.y = TOP_BOARD + PUCK_R; frame.puck.vy = Math.abs(frame.puck.vy) * 0.96; }
    if (frame.puck.y + PUCK_R > BOTTOM_BOARD) { frame.puck.y = BOTTOM_BOARD - PUCK_R; frame.puck.vy = -Math.abs(frame.puck.vy) * 0.96; }
    const inGoalMouth = frame.puck.y > GOAL_MIN && frame.puck.y < GOAL_MAX;
    if (!inGoalMouth && frame.puck.x - PUCK_R < LEFT_BOARD) { frame.puck.x = LEFT_BOARD + PUCK_R; frame.puck.vx = Math.abs(frame.puck.vx) * 0.96; }
    if (!inGoalMouth && frame.puck.x + PUCK_R > RIGHT_BOARD) { frame.puck.x = RIGHT_BOARD - PUCK_R; frame.puck.vx = -Math.abs(frame.puck.vx) * 0.96; }
    for (const player of players) {
      const paddle = frame.paddles[player.userId];
      collidePuckWithPaddle(frame, oldPuck, oldPaddles[player.userId] ?? paddle, paddle, player.side, stepDt);
    }
    const goalNow = frame.puck.y > GOAL_MIN && frame.puck.y < GOAL_MAX;
    if (goalNow && frame.puck.x < -0.01) {
      frame.rightScore += 1;
      if (frame.rightScore >= INTERNAL_MAX_SCORE) { frame.winnerSide = "right"; frame.puck = { x: 0.5, y: 0.5, vx: 0, vy: 0 }; frame.pauseUntil = Date.now(); }
      else resetFaceoff(simulation, players, mode, "left");
    } else if (goalNow && frame.puck.x > 1.01) {
      frame.leftScore += 1;
      if (frame.leftScore >= INTERNAL_MAX_SCORE) { frame.winnerSide = "left"; frame.puck = { x: 0.5, y: 0.5, vx: 0, vy: 0 }; frame.pauseUntil = Date.now(); }
      else resetFaceoff(simulation, players, mode, "right");
    }
  }
}

function predictPuck(puck: Puck, ageSeconds: number) {
  const dt = Math.min(ageSeconds, 0.11);
  let x = puck.x + puck.vx * dt, y = puck.y + puck.vy * dt, vx = puck.vx, vy = puck.vy;
  const minY = TOP_BOARD + PUCK_R, maxY = BOTTOM_BOARD - PUCK_R, minX = LEFT_BOARD + PUCK_R, maxX = RIGHT_BOARD - PUCK_R;
  if (y < minY) { y = minY + (minY - y); vy = Math.abs(vy); } else if (y > maxY) { y = maxY - (y - maxY); vy = -Math.abs(vy); }
  const inGoalMouth = y > GOAL_MIN && y < GOAL_MAX;
  if (!inGoalMouth) { if (x < minX) { x = minX + (minX - x); vx = Math.abs(vx); } else if (x > maxX) { x = maxX - (x - maxX); vx = -Math.abs(vx); } }
  return { x: clamp(x, -0.04, 1.04), y: clamp(y, TOP_BOARD, BOTTOM_BOARD), vx, vy };
}

function updateHockeyBots(simulation: Simulation, game: Game, now: number) {
  const bots = game.players.filter((player) => player.isBot);
  if (!bots.length) return;
  simulation.botStates ||= {};
  const puck = simulation.frame.puck;

  for (const bot of bots) {
    const paddle = simulation.frame.paddles[bot.userId] ?? initialPaddle(bot, game.mode);
    const difficulty = bot.difficulty ?? "normal";
    const baseSpeed = difficulty === "easy" ? 0.40 : difficulty === "hard" ? 0.72 : 0.54;
    const strikeSpeed = difficulty === "easy" ? 0.62 : difficulty === "hard" ? 1.02 : 0.78;
    const aimError = difficulty === "easy" ? 0.10 : difficulty === "hard" ? 0.035 : 0.065;
    const guardX = bot.side === "right" ? 0.82 : 0.18;
    const guardY = bot.slot < 0 ? 0.5 : bot.slot === 0 ? 0.34 : 0.66;
    const direction = bot.side === "right" ? -1 : 1;

    if (Date.now() < simulation.frame.pauseUntil) {
      simulation.botStates[bot.userId] = { phase: "recover", until: now + 350, aimY: guardY };
      simulation.targets[bot.userId] = { ...initialPaddle(bot, game.mode) };
      continue;
    }

    let state = simulation.botStates[bot.userId];
    if (!state) state = simulation.botStates[bot.userId] = { phase: "setup", until: 0, aimY: puck.y };

    const puckOnBotHalf = bot.side === "right" ? puck.x > 0.50 : puck.x < 0.50;
    const behindX = puck.x - direction * 0.115;
    const strikeX = puck.x + direction * 0.105;
    const wobble = Math.sin(now / 530 + game.leftScore * 1.9 + game.rightScore * 1.3 + bot.slot * 1.7) * aimError;

    let desiredX = guardX;
    let desiredY = clamp(puck.y + wobble, 0.12, 0.88);
    let speed = baseSpeed;

    if (!puckOnBotHalf && state.phase !== "strike") {
      state.phase = "recover";
      state.until = now + 280;
    }

    if (state.phase === "recover") {
      desiredX = guardX;
      desiredY = clamp(guardY + wobble * 0.5, 0.16, 0.84);
      if (now >= state.until && Math.hypot(paddle.x - guardX, paddle.y - desiredY) < 0.08) {
        state.phase = "setup";
        state.aimY = puck.y;
      }
    } else if (state.phase === "setup") {
      desiredX = clampPaddle(bot.side, behindX, puck.y).x;
      desiredY = clamp(puck.y + wobble, 0.12, 0.88);
      const distanceToSetup = Math.hypot(paddle.x - desiredX, paddle.y - desiredY);
      if (puckOnBotHalf && distanceToSetup < 0.045) {
        state.phase = "strike";
        state.until = now + (difficulty === "hard" ? 180 : difficulty === "easy" ? 135 : 155);
        state.aimY = clamp(puck.y + wobble, 0.12, 0.88);
      }
    } else {
      desiredX = clampPaddle(bot.side, strikeX, state.aimY).x;
      desiredY = state.aimY;
      speed = strikeSpeed;
      if (now >= state.until) {
        state.phase = "recover";
        state.until = now + (difficulty === "hard" ? 260 : difficulty === "easy" ? 480 : 360);
      }
    }

    const dt = clamp((now - simulation.lastTs) / 1000, 0.008, 0.032);
    const dx = desiredX - paddle.x, dy = desiredY - paddle.y, distance = Math.hypot(dx, dy);
    const maxMove = speed * dt;
    const factor = distance > maxMove && distance > 0.0001 ? maxMove / distance : 1;
    const point = clampPaddle(bot.side, paddle.x + dx * factor, paddle.y + dy * factor);
    simulation.targets[bot.userId] = {
      x: point.x, y: point.y,
      vx: (point.x - paddle.x) / Math.max(dt, 0.001),
      vy: (point.y - paddle.y) / Math.max(dt, 0.001),
    };
  }
}

export default function HockeyGame({ room, user }: { room: Room; user: User; onActiveChange?: (active: boolean) => void }) {
  const [game, setGame] = useState<Game | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [botDifficulty, setBotDifficulty] = useState<BotDifficulty>("normal");
  const [teamAssignments, setTeamAssignments] = useState<Record<string, Side | "bench">>({});
  const [twoPlayerSide, setTwoPlayerSide] = useState<Side>("left");
  const [focusSuppressed, setFocusSuppressed] = useState(false);
  const [frame, setFrame] = useState<Frame | null>(null);
  const [avatarData, setAvatarData] = useState<string | null>(user.avatarData ?? null);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [clock, setClock] = useState(Date.now());

  const gameRef = useRef<Game | null>(null);
  const rinkRef = useRef<HTMLDivElement | null>(null);
  const simulationRef = useRef<Simulation | null>(null);
  const peersRef = useRef<Map<string, PeerEntry>>(new Map());
  const pendingIceRef = useRef<Map<string, RTCIceCandidateInit[]>>(new Map());
  const signalCursorRef = useRef(0);
  const localInputRef = useRef<InputPacket | null>(null);
  const localPaddleRef = useRef<{ x: number; y: number } | null>(null);
  const lastInputRef = useRef({ x: 0.5, y: 0.5, at: performance.now() });
  const draggingRef = useRef(false);
  const lastDirectInputSendRef = useRef(0);
  const lastFallbackInputSendRef = useRef(0);
  const remoteSnapshotRef = useRef<{ frame: Frame; receivedAt: number } | null>(null);
  const reconnectingRef = useRef<Set<string>>(new Set());
  const directAckRef = useRef<Map<string, number>>(new Map());
  const lastDirectStateAtRef = useRef(0);
  const peerStartedAtRef = useRef<Map<string, number>>(new Map());

  useEffect(() => { gameRef.current = game; }, [game]);
  useEffect(() => {
    if (!game || game.status === "lobby" || !game.endsAt) return;
    const id = window.setInterval(() => setClock(Date.now()), 200);
    return () => window.clearInterval(id);
  }, [game?.status, game?.endsAt]);

  const me = useMemo(() => game?.players.find((player) => player.userId === user.id) ?? null, [game, user.id]);
  const left = useMemo(() => game?.players.filter((player) => player.side === "left") ?? [], [game]);
  const right = useMemo(() => game?.players.filter((player) => player.side === "right") ?? [], [game]);
  const rosterKey = useMemo(() => game?.players.map((player) => player.userId).join(",") ?? "", [game?.players]);
  const isHost = room.hostId === user.id;
  const needed = game?.mode === "2v2" ? 4 : game?.mode === "2v1" ? 3 : 2;
  const onlineMembers = useMemo(() => room.members.filter((member) => member.online), [room.members]);
  const onlineKey = onlineMembers.map((member) => member.id).join("|");
  const online = onlineMembers.length;
  const caps = teamCaps(game?.mode ?? "1v1", twoPlayerSide);
  const leftHumans = onlineMembers.filter((member) => teamAssignments[member.id] === "left").length;
  const rightHumans = onlineMembers.filter((member) => teamAssignments[member.id] === "right").length;
  const selectedHumans = leftHumans + rightHumans;
  const missingBots = Math.max(0, caps.left - leftHumans) + Math.max(0, caps.right - rightHumans);

  const applyGame = useCallback((next: Game) => { gameRef.current = next; setGame(next); setError(""); }, []);
  useEffect(() => {
    if (!game || game.status !== "lobby" || !isHost) return;
    const currentCaps = teamCaps(game.mode, twoPlayerSide);
    setTeamAssignments((previous) => {
      const next: Record<string, Side | "bench"> = {};
      let leftCount = 0, rightCount = 0;
      for (const member of onlineMembers) {
        const old = previous[member.id];
        if (old === "left" && leftCount < currentCaps.left) { next[member.id] = "left"; leftCount++; }
        else if (old === "right" && rightCount < currentCaps.right) { next[member.id] = "right"; rightCount++; }
        else next[member.id] = "bench";
      }
      for (const member of onlineMembers) {
        if (next[member.id] !== "bench") continue;
        if (leftCount < currentCaps.left) { next[member.id] = "left"; leftCount++; }
        else if (rightCount < currentCaps.right) { next[member.id] = "right"; rightCount++; }
      }
      return next;
    });
  }, [game?.status, game?.mode, isHost, onlineKey, twoPlayerSide]);

  const assignTeam = useCallback((memberId: string, side: Side | "bench") => {
    if (!game) return;
    setTeamAssignments((previous) => {
      const next = { ...previous };
      if (side === "bench") { next[memberId] = "bench"; return next; }
      const currentCaps = teamCaps(game.mode, twoPlayerSide);
      const used = onlineMembers.filter((member) => member.id !== memberId && next[member.id] === side).length;
      if (used >= currentCaps[side]) return next;
      next[memberId] = side;
      return next;
    });
  }, [game, onlineMembers, twoPlayerSide]);

  useEffect(() => {
    if (game?.status === "lobby") setFocusSuppressed(false);
  }, [game?.status]);
  useEffect(() => {
    if (!game) return;
    const active = game.status === "playing" || game.status === "gameover";
    window.dispatchEvent(new CustomEvent("retro:game-active", { detail: active ? "hockey" : null }));
  }, [game?.status]);
  useEffect(() => {
    const returnToRoom = () => setFocusSuppressed(true);
    window.addEventListener("retro:return-room", returnToRoom);
    return () => window.removeEventListener("retro:return-room", returnToRoom);
  }, []);
  const resetLocalToStart = useCallback((current: Game) => {
    const own = current.players.find((player) => player.userId === user.id); if (!own) return;
    const paddle = initialPaddle(own, current.mode);
    localInputRef.current = { x: paddle.x, y: paddle.y, vx: 0, vy: 0 };
    localPaddleRef.current = { x: paddle.x, y: paddle.y };
    lastInputRef.current = { x: paddle.x, y: paddle.y, at: performance.now() };
    draggingRef.current = false;
  }, [user.id]);

  const sendSignal = useCallback(async (targetId: string, kind: Signal["kind"], signalPayload: unknown) => { await post({ action: "hockeySignal", code: room.code, targetId, kind, payload: signalPayload }); }, [room.code]);
  const closePeer = useCallback((peerId: string) => {
    const entry = peersRef.current.get(peerId);
    if (entry) { try { entry.dc?.close(); } catch {} try { entry.pc.close(); } catch {} peersRef.current.delete(peerId); }
    directAckRef.current.delete(peerId);
    peerStartedAtRef.current.delete(peerId);
    reconnectingRef.current.delete(peerId);
  }, []);
  const closeAllPeers = useCallback(() => { for (const peerId of [...peersRef.current.keys()]) closePeer(peerId); pendingIceRef.current.clear(); directAckRef.current.clear(); peerStartedAtRef.current.clear(); lastDirectStateAtRef.current = 0; reconnectingRef.current.clear(); }, [closePeer]);
  const flushIce = useCallback(async (peerId: string, pc: RTCPeerConnection) => {
    if (!pc.remoteDescription) return;
    const queue = pendingIceRef.current.get(peerId) ?? []; pendingIceRef.current.set(peerId, []);
    for (const candidate of queue) { try { await pc.addIceCandidate(candidate); } catch {} }
  }, []);

  const receiveInput = useCallback((senderId: string, payloadValue: unknown) => {
    const current = gameRef.current, simulation = simulationRef.current;
    if (!current || !simulation || room.hostId !== user.id || Date.now() < simulation.frame.pauseUntil) return;
    const player = current.players.find((entry) => entry.userId === senderId);
    if (!player || !payloadValue || typeof payloadValue !== "object") return;
    const value = payloadValue as Partial<InputPacket>;
    const point = clampPaddle(player.side, Number(value.x), Number(value.y));
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return;
    const velocity = capVelocity(Number(value.vx) || 0, Number(value.vy) || 0, MAX_MALLET_SPEED);
    simulation.targets[senderId] = { x: point.x, y: point.y, vx: velocity.x, vy: velocity.y };
  }, [room.hostId, user.id]);

  const receiveState = useCallback((payloadValue: unknown) => {
    if (!payloadValue || typeof payloadValue !== "object") return;
    const incoming = payloadValue as Frame; if (!incoming.puck || !incoming.paddles) return;
    const copy = cloneFrame(incoming), current = gameRef.current;
    if (current && copy.pauseUntil > Date.now()) resetLocalToStart(current);
    remoteSnapshotRef.current = { frame: copy, receivedAt: performance.now() };
    if (room.hostId !== user.id) setFrame(copy);
  }, [resetLocalToStart, room.hostId, user.id]);

  const attachDataChannel = useCallback((peerId: string, channel: RTCDataChannel, hostSide: boolean) => {
    const entry = peersRef.current.get(peerId); if (entry) entry.dc = channel; channel.binaryType = "arraybuffer";
    channel.onopen = () => {
      reconnectingRef.current.delete(peerId);
      if (hostSide) directAckRef.current.set(peerId, performance.now()); else lastDirectStateAtRef.current = performance.now();
      if (hostSide && simulationRef.current && channel.readyState === "open") { try { channel.send(JSON.stringify({ type: "state", state: simulationRef.current.frame })); } catch {} }
    };
    channel.onmessage = (event) => {
      try {
        const message = JSON.parse(String(event.data));
        if (hostSide && message.type === "input") receiveInput(peerId, message.input);
        else if (hostSide && message.type === "ack") directAckRef.current.set(peerId, performance.now());
        else if (!hostSide && message.type === "state") {
          lastDirectStateAtRef.current = performance.now(); receiveState(message.state);
          if (channel.readyState === "open") { try { channel.send(JSON.stringify({ type: "ack" })); } catch {} }
        }
      } catch {}
    };
    channel.onclose = () => closePeer(peerId); channel.onerror = () => undefined;
  }, [closePeer, receiveInput, receiveState]);

  const makePeer = useCallback((peerId: string, hostSide: boolean) => {
    const old = peersRef.current.get(peerId); if (old && old.pc.connectionState !== "failed" && old.pc.connectionState !== "closed") return old; if (old) closePeer(peerId);
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS, iceCandidatePoolSize: 4 }); const entry: PeerEntry = { pc, dc: null }; peersRef.current.set(peerId, entry); peerStartedAtRef.current.set(peerId, performance.now());
    pc.onicecandidate = (event) => { if (event.candidate) void sendSignal(peerId, "ice", event.candidate.toJSON()).catch(() => undefined); };
    pc.onconnectionstatechange = () => { if (pc.connectionState === "failed" || pc.connectionState === "closed") closePeer(peerId); if (pc.connectionState === "disconnected") window.setTimeout(() => { if (pc.connectionState === "disconnected") closePeer(peerId); }, 900); };
    if (!hostSide) pc.ondatachannel = (event) => attachDataChannel(peerId, event.channel, false);
    return entry;
  }, [attachDataChannel, closePeer, sendSignal]);

  const startHostPeer = useCallback(async (peerId: string) => {
    if (peerId === user.id || reconnectingRef.current.has(peerId)) return;
    const existing = peersRef.current.get(peerId); const now = performance.now(); const ackAge = now - (directAckRef.current.get(peerId) ?? 0); const connectingAge = now - (peerStartedAtRef.current.get(peerId) ?? 0); if (existing?.dc?.readyState === "open" && ackAge < 1800) return; if (existing?.pc.connectionState === "connecting" && connectingAge < 3500) return;
    reconnectingRef.current.add(peerId);
    try { if (existing) closePeer(peerId); const entry = makePeer(peerId, true); const channel = entry.pc.createDataChannel("retro-hockey", { ordered: false, maxPacketLifeTime: 180 }); entry.dc = channel; attachDataChannel(peerId, channel, true); const offer = await entry.pc.createOffer(); await entry.pc.setLocalDescription(offer); await sendSignal(peerId, "offer", offer); }
    catch { closePeer(peerId); } finally { window.setTimeout(() => reconnectingRef.current.delete(peerId), 600); }
  }, [attachDataChannel, closePeer, makePeer, sendSignal, user.id]);

  const handleSignal = useCallback(async (signal: Signal) => {
    const current = gameRef.current; if (!current || current.status === "lobby") return; const hostId = room.hostId;
    if (signal.kind === "input") { if (user.id === hostId) receiveInput(signal.senderId, signal.payload); return; }
    if (signal.kind === "state") { if (user.id !== hostId && signal.senderId === hostId) receiveState(signal.payload); return; }
    if (user.id === hostId) {
      if (signal.senderId === user.id) return; const entry = peersRef.current.get(signal.senderId);
      if (signal.kind === "answer" && entry) { try { await entry.pc.setRemoteDescription(signal.payload as RTCSessionDescriptionInit); await flushIce(signal.senderId, entry.pc); } catch { closePeer(signal.senderId); } }
      else if (signal.kind === "ice") { const candidate = signal.payload as RTCIceCandidateInit; if (entry?.pc.remoteDescription) { try { await entry.pc.addIceCandidate(candidate); } catch {} } else { const queue = pendingIceRef.current.get(signal.senderId) ?? []; queue.push(candidate); pendingIceRef.current.set(signal.senderId, queue); } }
      return;
    }
    if (signal.senderId !== hostId) return;
    if (signal.kind === "offer") { try { closePeer(hostId); const entry = makePeer(hostId, false); await entry.pc.setRemoteDescription(signal.payload as RTCSessionDescriptionInit); await flushIce(hostId, entry.pc); const answer = await entry.pc.createAnswer(); await entry.pc.setLocalDescription(answer); await sendSignal(hostId, "answer", answer); } catch { closePeer(hostId); } }
    else if (signal.kind === "ice") { const entry = peersRef.current.get(hostId), candidate = signal.payload as RTCIceCandidateInit; if (entry?.pc.remoteDescription) { try { await entry.pc.addIceCandidate(candidate); } catch {} } else { const queue = pendingIceRef.current.get(hostId) ?? []; queue.push(candidate); pendingIceRef.current.set(hostId, queue); } }
  }, [closePeer, flushIce, makePeer, receiveInput, receiveState, room.hostId, sendSignal, user.id]);

  useEffect(() => {
    let alive = true; let timer: number | undefined;
    const poll = async () => {
      if (!alive) return;
      try { const current = gameRef.current; const data = await post({ action: "hockeyState", code: room.code }); if (alive) { const next = data.game as Game; gameRef.current = next; setGame(next); setError(""); } const delay = current?.status === "playing" ? 6000 : 1800; if (alive) timer = window.setTimeout(() => void poll(), delay); }
      catch (pollError) {
        if (alive) {
          const current = gameRef.current;
          const message = pollError instanceof Error ? pollError.message : "Hockey indisponible.";
          if (!current || current.status === "lobby") setError(message);
          timer = window.setTimeout(() => void poll(), current?.status === "playing" ? 7000 : 2200);
        }
      }
    };
    void poll(); return () => { alive = false; if (timer !== undefined) window.clearTimeout(timer); };
  }, [room.code]);

  useEffect(() => { const active = (game?.status === "playing" || game?.status === "gameover") && !focusSuppressed; document.body.classList.toggle("hockey-match-active", Boolean(active)); return () => document.body.classList.remove("hockey-match-active"); }, [game?.status, focusSuppressed]);

  useEffect(() => {
    if (!game || game.status === "lobby") { closeAllPeers(); simulationRef.current = null; remoteSnapshotRef.current = null; signalCursorRef.current = 0; localInputRef.current = null; localPaddleRef.current = null; draggingRef.current = false; setFrame(null); return; }
    signalCursorRef.current = 0; resetLocalToStart(game);
    const initialPauseUntil = Math.max(Date.now(), game.frame?.pauseUntil ?? ((game.startedAt ?? Date.now()) + INITIAL_COUNTDOWN_MS));
    if (room.hostId === user.id) {
      const key = `${game.mode}:${rosterKey}`;
      if (simulationRef.current?.key !== key) {
        const initialFrame = makeFrame(game.players, game.mode, game.leftScore, game.rightScore, initialPauseUntil);
        simulationRef.current = { key, frame: initialFrame, targets: Object.fromEntries(game.players.map((player) => [player.userId, initialPaddle(player, game.mode)])), lastTs: performance.now(), lastBroadcast: 0, lastFallbackBroadcast: 0, lastCheckpointLeft: game.leftScore, lastCheckpointRight: game.rightScore, timeoutResolved: false };
        setFrame(cloneFrame(initialFrame));
      }
    } else if (!frame) {
      const initialFrame = makeFrame(game.players, game.mode, game.leftScore, game.rightScore, initialPauseUntil);
      remoteSnapshotRef.current = { frame: cloneFrame(initialFrame), receivedAt: performance.now() };
      setFrame(initialFrame);
    }
  }, [closeAllPeers, game?.status, game?.mode, resetLocalToStart, room.hostId, rosterKey, user.id]);

  useEffect(() => () => closeAllPeers(), [closeAllPeers]);

  useEffect(() => {
    if (!game || game.status === "lobby") return; let alive = true; let timer: number | undefined;
    const signalPoll = async () => {
      if (!alive) return;
      try { const data = await post({ action: "hockeySignalPoll", code: room.code, after: signalCursorRef.current }); if (!alive) return; signalCursorRef.current = Number(data.cursor ?? signalCursorRef.current); for (const signal of (data.signals ?? []) as Signal[]) await handleSignal(signal); } catch {}
      const current = gameRef.current; let directReady = false; const now = performance.now();
      if (current && current.status !== "lobby") {
        if (room.hostId === user.id) {
          const remotes = current.players.filter((player) => player.userId !== user.id && !player.isBot);
          directReady = remotes.length > 0 && remotes.every((player) => peersRef.current.get(player.userId)?.dc?.readyState === "open" && now - (directAckRef.current.get(player.userId) ?? 0) < 1200);
        } else directReady = peersRef.current.get(room.hostId)?.dc?.readyState === "open" && now - lastDirectStateAtRef.current < 1200;
      }
      timer = window.setTimeout(() => void signalPoll(), directReady ? 700 : 120);
    };
    void signalPoll(); return () => { alive = false; if (timer !== undefined) window.clearTimeout(timer); };
  }, [game?.status, handleSignal, room.code, room.hostId, user.id]);

  useEffect(() => {
    if (!game || game.status !== "playing" || room.hostId !== user.id) return;
    const ensure = () => { const current = gameRef.current; if (!current || current.status === "lobby") return; for (const player of current.players) if (player.userId !== user.id && !player.isBot) void startHostPeer(player.userId); };
    ensure(); const id = window.setInterval(ensure, 900); return () => window.clearInterval(id);
  }, [game?.status, room.hostId, startHostPeer, user.id]);

  const checkpoint = useCallback((leftScore: number, rightScore: number, winnerSide?: Side | null) => { void post({ action: "hockeyCheckpoint", code: room.code, leftScore, rightScore, winnerSide: winnerSide ?? null }).catch(() => undefined); }, [room.code]);

  useEffect(() => {
    if (!game || game.status === "lobby" || room.hostId !== user.id) return; let raf = 0;
    const tick = (now: number) => {
      const current = gameRef.current, simulation = simulationRef.current;
      if (!current || !simulation || current.status === "lobby" || room.hostId !== user.id) return;
      if (Date.now() >= simulation.frame.pauseUntil) { const local = localInputRef.current; if (local) { const own = current.players.find((player) => player.userId === user.id); if (own) simulation.targets[user.id] = { ...local }; } }
      updateHockeyBots(simulation, current, now);

      let suddenDeath = false;
      if (!simulation.frame.winnerSide && current.endsAt && Date.now() >= current.endsAt) {
        if (simulation.frame.leftScore !== simulation.frame.rightScore) {
          simulation.frame.winnerSide = simulation.frame.leftScore > simulation.frame.rightScore ? "left" : "right";
          simulation.frame.puck = { x: 0.5, y: 0.5, vx: 0, vy: 0 };
          if (!simulation.timeoutResolved) { simulation.timeoutResolved = true; checkpoint(simulation.frame.leftScore, simulation.frame.rightScore, simulation.frame.winnerSide); }
        } else suddenDeath = true;
      }

      const beforeLeft = simulation.frame.leftScore, beforeRight = simulation.frame.rightScore;
      const dt = clamp((now - simulation.lastTs) / 1000, 0.001, 0.032); simulation.lastTs = now;
      stepSimulation(simulation, current.players, current.mode, dt);

      if (!simulation.frame.winnerSide) {
        if (simulation.frame.leftScore >= current.targetScore) simulation.frame.winnerSide = "left";
        else if (simulation.frame.rightScore >= current.targetScore) simulation.frame.winnerSide = "right";
        else if (suddenDeath && (simulation.frame.leftScore !== beforeLeft || simulation.frame.rightScore !== beforeRight)) simulation.frame.winnerSide = simulation.frame.leftScore > simulation.frame.rightScore ? "left" : "right";
        if (simulation.frame.winnerSide) { simulation.frame.puck = { x: 0.5, y: 0.5, vx: 0, vy: 0 }; simulation.frame.pauseUntil = Date.now(); }
      }

      setFrame(cloneFrame(simulation.frame));
      if (simulation.frame.leftScore !== simulation.lastCheckpointLeft || simulation.frame.rightScore !== simulation.lastCheckpointRight) {
        simulation.lastCheckpointLeft = simulation.frame.leftScore; simulation.lastCheckpointRight = simulation.frame.rightScore; resetLocalToStart(current); checkpoint(simulation.frame.leftScore, simulation.frame.rightScore, simulation.frame.winnerSide);
      }
      if (now - simulation.lastBroadcast >= 33) { simulation.lastBroadcast = now; const message = JSON.stringify({ type: "state", state: simulation.frame }); for (const player of current.players) { if (player.userId === user.id || player.isBot) continue; const channel = peersRef.current.get(player.userId)?.dc; if (channel?.readyState === "open") { try { channel.send(message); } catch {} } } }
      if (now - simulation.lastFallbackBroadcast >= 150) { simulation.lastFallbackBroadcast = now; for (const player of current.players) { if (player.userId === user.id || player.isBot) continue; const channel = peersRef.current.get(player.userId)?.dc; const healthy = channel?.readyState === "open" && now - (directAckRef.current.get(player.userId) ?? 0) < 900; if (!healthy) void sendSignal(player.userId, "state", simulation.frame).catch(() => undefined); } }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick); return () => cancelAnimationFrame(raf);
  }, [checkpoint, game?.status, resetLocalToStart, room.hostId, sendSignal, user.id]);

  useEffect(() => {
    if (!game || game.status === "lobby" || room.hostId === user.id) return; let raf = 0;
    const draw = (now: number) => { const current = gameRef.current, snapshot = remoteSnapshotRef.current; if (current && snapshot) { const age = (now - snapshot.receivedAt) / 1000, next = cloneFrame(snapshot.frame); if (Date.now() >= next.pauseUntil && !next.winnerSide) next.puck = predictPuck(next.puck, age); for (const player of current.players) { const server = snapshot.frame.paddles[player.userId] ?? initialPaddle(player, current.mode); if (player.userId === user.id && localPaddleRef.current) next.paddles[player.userId] = { ...server, ...localPaddleRef.current }; else { const dt = Math.min(age, 0.075), predicted = clampPaddle(player.side, server.x + server.vx * dt, server.y + server.vy * dt); next.paddles[player.userId] = { ...server, x: predicted.x, y: predicted.y }; } } setFrame(next); } raf = requestAnimationFrame(draw); };
    raf = requestAnimationFrame(draw); return () => cancelAnimationFrame(raf);
  }, [game?.status, room.hostId, user.id]);

  const sendRemoteInput = useCallback((packet: InputPacket, force = false) => {
    if (room.hostId === user.id) return; const now = performance.now(), channel = peersRef.current.get(room.hostId)?.dc;
    const directHealthy = channel?.readyState === "open" && now - lastDirectStateAtRef.current < 1200;
    if (channel?.readyState === "open") { if (force || now - lastDirectInputSendRef.current >= 12) { lastDirectInputSendRef.current = now; try { channel.send(JSON.stringify({ type: "input", input: packet })); } catch {} } if (directHealthy) return; }
    if (force || now - lastFallbackInputSendRef.current >= 100) { lastFallbackInputSendRef.current = now; void sendSignal(room.hostId, "input", packet).catch(() => undefined); }
  }, [room.hostId, sendSignal, user.id]);

  useEffect(() => { if (!game || game.status !== "playing" || room.hostId === user.id) return; const id = window.setInterval(() => { if (!draggingRef.current || !localInputRef.current) return; const snapshot = remoteSnapshotRef.current?.frame; if (snapshot && Date.now() < snapshot.pauseUntil) return; sendRemoteInput(localInputRef.current, true); }, 28); return () => window.clearInterval(id); }, [game?.status, room.hostId, sendRemoteInput, user.id]);

  const moveLocalPaddle = useCallback((x: number, y: number) => {
    const current = gameRef.current, player = current?.players.find((entry) => entry.userId === user.id); if (!current || !player || current.status !== "playing") return;
    const activeFrame = room.hostId === user.id ? simulationRef.current?.frame : remoteSnapshotRef.current?.frame; if (activeFrame && Date.now() < activeFrame.pauseUntil) return;
    const point = clampPaddle(player.side, x, y), now = performance.now(), dt = Math.max(0.008, (now - lastInputRef.current.at) / 1000);
    let vx = (point.x - lastInputRef.current.x) / dt, vy = (point.y - lastInputRef.current.y) / dt; const velocity = capVelocity(vx, vy, MAX_MALLET_SPEED); vx = velocity.x; vy = velocity.y;
    const packet = { x: point.x, y: point.y, vx, vy }; lastInputRef.current = { x: point.x, y: point.y, at: now }; localInputRef.current = packet; localPaddleRef.current = point;
    if (room.hostId === user.id) { const simulation = simulationRef.current; if (simulation) simulation.targets[user.id] = { ...packet }; } else sendRemoteInput(packet);
  }, [room.hostId, sendRemoteInput, user.id]);

  const pointerPosition = (event: PointerEvent<HTMLDivElement>) => { const rect = rinkRef.current?.getBoundingClientRect(); if (rect) moveLocalPaddle((event.clientX - rect.left) / rect.width, (event.clientY - rect.top) / rect.height); };
  const pointerDown = (event: PointerEvent<HTMLDivElement>) => { const activeFrame = room.hostId === user.id ? simulationRef.current?.frame : remoteSnapshotRef.current?.frame; if (activeFrame && Date.now() < activeFrame.pauseUntil) return; draggingRef.current = true; try { event.currentTarget.setPointerCapture(event.pointerId); } catch {} pointerPosition(event); };
  const pointerMove = (event: PointerEvent<HTMLDivElement>) => { if (draggingRef.current) pointerPosition(event); };
  const pointerUp = (event: PointerEvent<HTMLDivElement>) => { if (draggingRef.current) pointerPosition(event); draggingRef.current = false; if (localInputRef.current && room.hostId !== user.id) sendRemoteInput(localInputRef.current, true); try { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); } catch {} };

  const uploadAvatar = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]; event.target.value = ""; if (!file) return;
    try { setAvatarBusy(true); setError(""); const prepared = await compressAvatar(file); const data = await postAuth({ action: "avatar", avatarData: prepared }); setAvatarData(data.user?.avatarData ?? prepared); }
    catch (avatarError) { setError(avatarError instanceof Error ? avatarError.message : "Impossible d'enregistrer la photo."); }
    finally { setAvatarBusy(false); }
  };
  const removeAvatar = async () => { try { setAvatarBusy(true); setError(""); await postAuth({ action: "avatar", avatarData: null }); setAvatarData(null); } catch (avatarError) { setError(avatarError instanceof Error ? avatarError.message : "Impossible de retirer la photo."); } finally { setAvatarBusy(false); } };

  const configure = async (mode: Mode, targetScore: number, timeLimitSec: number) => {
    try { setBusy(true); applyGame((await post({ action: "hockeyConfigure", code: room.code, mode, targetScore, timeLimitSec })).game as Game); }
    catch (actionError) { setError(actionError instanceof Error ? actionError.message : "Erreur."); }
    finally { setBusy(false); }
  };
  const start = async (fillBots = false, assignments: Record<string, Side | "bench"> = teamAssignments, twoSide: Side = twoPlayerSide, difficulty: BotDifficulty = botDifficulty) => {
    try {
      setBusy(true); signalCursorRef.current = 0; closeAllPeers(); setFocusSuppressed(false);
      applyGame((await post({ action: "hockeyStart", code: room.code, fillBots, botDifficulty: fillBots ? difficulty : null, teamAssignments: assignments, twoPlayerSide: twoSide })).game as Game);
      setClock(Date.now());
    } catch (actionError) { setError(actionError instanceof Error ? actionError.message : "Erreur."); }
    finally { setBusy(false); }
  };
  const stop = async () => {
    try { setBusy(true); setFocusSuppressed(false); applyGame((await post({ action: "hockeyStop", code: room.code })).game as Game); }
    catch (actionError) { setError(actionError instanceof Error ? actionError.message : "Impossible de revenir au lobby du hockey."); }
    finally { setBusy(false); }
  };
  const replay = async () => {
    if (!game) return;
    const assignments = Object.fromEntries(game.players.filter((player) => !player.isBot).map((player) => [player.userId, player.side])) as Record<string, Side | "bench">;
    const leftCount = game.players.filter((player) => player.side === "left").length;
    const replayTwoSide: Side = game.mode === "2v1" && leftCount !== 2 ? "right" : "left";
    const bot = game.players.find((player) => player.isBot);
    await start(Boolean(bot), assignments, replayTwoSide, bot?.difficulty ?? botDifficulty);
  };

  if (!game) return <section className="hockeyLobby"><div className="spinner"/><p>Chargement du hockey…</p>{error && <div className="errorBox">{error}</div>}</section>;

  if (game.status === "lobby") {
    return <section className="hockeyLobby">
      <div className="hockeyHero"><div className="hockeyDisc">🏒</div><div><span className="kicker">HOCKEY ARCADE</span><h2>Hockey sur glace</h2><p>Choisis le mode puis lance la partie.</p></div></div>
      <div className="modePicker hockeyModePicker3">
        <button className={game.mode === "1v1" ? "selected" : ""} disabled={!isHost || busy} onClick={() => void configure("1v1", game.targetScore, game.timeLimitSec)}><strong>1 VS 1</strong><small>2 joueurs</small></button>
        <button className={game.mode === "2v1" ? "selected" : ""} disabled={!isHost || busy} onClick={() => void configure("2v1", game.targetScore, game.timeLimitSec)}><strong>2 VS 1</strong><small>3 joueurs</small></button>
        <button className={game.mode === "2v2" ? "selected" : ""} disabled={!isHost || busy} onClick={() => void configure("2v2", game.targetScore, game.timeLimitSec)}><strong>2 VS 2</strong><small>4 joueurs</small></button>
      </div>
      <div className="hockeyRuleSettings">
        <label><small>Points pour gagner</small><select value={game.targetScore} disabled={!isHost || busy} onChange={(event) => void configure(game.mode, Number(event.target.value), game.timeLimitSec)}>{SCORE_OPTIONS.map((score) => <option key={score} value={score}>{score} points</option>)}</select></label>
        <label><small>Temps imparti</small><select value={game.timeLimitSec} disabled={!isHost || busy} onChange={(event) => void configure(game.mode, game.targetScore, Number(event.target.value))}>{TIME_OPTIONS.map((seconds) => <option key={seconds} value={seconds}>{timeLabel(seconds)}</option>)}</select></label>
      </div>
      <div className="hockeyAvatarSetup">
        <div className="hockeyAvatarPreview">{avatarData ? <img src={avatarData} alt="Photo du joueur"/> : <span>{user.username.slice(0, 2).toUpperCase()}</span>}</div>
        <div className="hockeyAvatarCopy"><strong>Photo sur ton rond</strong><small>Elle sera visible par tous pendant le match.</small></div>
        <label className={`hockeyAvatarButton ${avatarBusy ? "disabled" : ""}`}>{avatarBusy ? "Préparation…" : avatarData ? "Changer" : "Choisir une photo"}<input type="file" accept="image/*" disabled={avatarBusy} onChange={(event) => void uploadAvatar(event)}/></label>
        {avatarData && <button className="hockeyAvatarRemove" disabled={avatarBusy} onClick={() => void removeAvatar()}>Retirer</button>}
      </div>
      {isHost && <div className="hockeyTeamSetup">
        <div className="hockeyTeamSetupHead"><div><strong>Équipes</strong><small>Choisis qui joue en bleu, rouge ou reste sur le banc.</small></div>{game.mode === "2v1" && <div className="twoPlayerSidePicker"><span>Équipe à 2</span><button className={twoPlayerSide === "left" ? "active blue" : ""} onClick={() => setTwoPlayerSide("left")}>BLEU</button><button className={twoPlayerSide === "right" ? "active red" : ""} onClick={() => setTwoPlayerSide("right")}>ROUGE</button></div>}</div>
        <div className="hockeyTeamRows">{onlineMembers.map((member) => <div className="hockeyTeamRow" key={member.id}><strong>{member.username}{member.id === user.id ? " (toi)" : ""}</strong><div><button className={teamAssignments[member.id] === "left" ? "selected blue" : ""} onClick={() => assignTeam(member.id, "left")}>BLEU</button><button className={teamAssignments[member.id] === "right" ? "selected red" : ""} onClick={() => assignTeam(member.id, "right")}>ROUGE</button><button className={teamAssignments[member.id] === "bench" ? "selected bench" : ""} onClick={() => assignTeam(member.id, "bench")}>BANC</button></div></div>)}</div>
        <div className="hockeyTeamCounts"><span className={leftHumans === caps.left ? "full" : ""}>Bleu {leftHumans}/{caps.left}</span><span className={rightHumans === caps.right ? "full" : ""}>Rouge {rightHumans}/{caps.right}</span></div>
      </div>}
      <div className="hockeyReadyBar"><span>{selectedHumans}/{needed} places humaines remplies</span>{isHost && missingBots === 0 ? <button className="primaryButton" disabled={busy} onClick={() => void start(false)}>{busy ? "Lancement…" : `Lancer le ${game.mode}`}</button> : !isHost ? <small>En attente de l'hôte…</small> : <small>{missingBots} place{missingBots > 1 ? "s" : ""} libre{missingBots > 1 ? "s" : ""}</small>}</div>
      {isHost && missingBots > 0 && selectedHumans > 0 && <div className="botPlayPanel"><div><strong>🤖 Compléter avec des bots</strong><small>Ajoute automatiquement {missingBots} bot{missingBots > 1 ? "s" : ""} dans les places libres.</small></div><select value={botDifficulty} onChange={(event) => setBotDifficulty(event.target.value as BotDifficulty)}><option value="easy">Facile</option><option value="normal">Normal</option><option value="hard">Difficile</option></select><button disabled={busy} onClick={() => void start(true)}>Compléter et lancer</button></div>}
      {error && <div className="errorBox">{error}</div>}
    </section>;
  }

  if (focusSuppressed) return <section className="gameInProgressCard"><div><span className="kicker">HOCKEY EN COURS</span><h2>Match en cours</h2><p>Tu es revenu dans la room. Le match continue en arrière-plan.</p></div><button className="primaryButton" onClick={() => setFocusSuppressed(false)}>Revenir au match</button></section>;

  const fallback = makeFrame(game.players, game.mode, game.leftScore, game.rightScore);
  const shown = frame ?? fallback;
  const winners = (shown.winnerSide === "left" ? left : right).map((player) => player.username).join(" & ");
  const countdown = !shown.winnerSide && shown.pauseUntil > Date.now() ? Math.max(1, Math.ceil((shown.pauseUntil - Date.now()) / 1000)) : 0;
  const remaining = game.endsAt ? Math.max(0, Math.ceil((game.endsAt - clock) / 1000)) : null;
  const suddenDeath = remaining === 0 && !shown.winnerSide && shown.leftScore === shown.rightScore;

  return <section className="hockeyGameWrap hockeyGameLive">
    <div className="hockeyMatchRules"><span>Premier à {game.targetScore}</span>{remaining !== null && <strong className={suddenDeath ? "sudden" : ""}>{suddenDeath ? "MORT SUBITE" : formatClock(remaining)}</strong>}</div>
    <div className="hockeyGameTop hockeyScoreOnly"><div className="teamNames leftTeam"><small>BLEU</small><strong>{left.map((player) => player.username).join(" · ")}</strong></div><div className="hockeyScore"><b>{shown.leftScore}</b><span>—</span><b>{shown.rightScore}</b></div><div className="teamNames rightTeam"><small>ROUGE</small><strong>{right.map((player) => player.username).join(" · ")}</strong></div></div>
    <div className="rinkFrame hockeyLiveRinkFrame">
      <div ref={rinkRef} className={`hockeyRink ${me ? "controllable" : "spectating"}`} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={pointerUp} onLostPointerCapture={() => { draggingRef.current = false; }}>
        <div className="rinkCenterLine"/><div className="rinkCenterCircle"/><div className="goal goalLeft"/><div className="goal goalRight"/><div className="goalCrease creaseLeft"/><div className="goalCrease creaseRight"/>
        {game.players.map((player) => {
          const serverPaddle = shown.paddles[player.userId] ?? initialPaddle(player, game.mode);
          const paddle = player.userId === user.id && localPaddleRef.current ? { ...serverPaddle, ...localPaddleRef.current } : serverPaddle;
          const picture = player.userId === user.id ? (avatarData ?? player.avatarData) : player.avatarData;
          return <div key={player.userId} className={`hockeyMallet ${player.side} ${player.userId === user.id ? "mine" : ""} ${picture ? "hasPhoto" : ""}`} style={{ left: `${paddle.x * 100}%`, top: `${paddle.y * 100}%`, transition: "none" }}>{picture ? <img src={picture} alt={player.username}/> : <span>{player.username.slice(0, 2).toUpperCase()}</span>}</div>;
        })}
        <div className="hockeyPuck" style={{ left: `${shown.puck.x * 100}%`, top: `${shown.puck.y * 100}%`, transition: "none" }}/>
        {countdown > 0 && <div className="hockeyCountdown"><b>{countdown}</b><span>{shown.leftScore === 0 && shown.rightScore === 0 ? "DÉPART" : "REPRISE"}</span></div>}
        {shown.winnerSide && <div className="hockeyWinnerOverlay"><span>🏆</span><h2>{winners || "Équipe"} gagne !</h2><p>{shown.leftScore} — {shown.rightScore}</p>{isHost ? <div className="gameEndActions"><button className="primaryButton" disabled={busy} onClick={() => void replay()}>Rejouer</button><button className="secondaryButton" disabled={busy} onClick={() => void stop()}>Lobby du jeu</button></div> : <small>En attente de l'hôte pour rejouer.</small>}</div>}
      </div>
    </div>
    {error && <div className="errorBox hockeyGameError">{error}</div>}
  </section>;
}
