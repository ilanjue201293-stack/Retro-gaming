"use client";

import { CSSProperties, PointerEvent, useEffect, useMemo, useRef, useState } from "react";

type User = { id: string; username: string };
type RoomMember = { id: string; username: string; online: boolean; joined_at: string };
type Room = { code: string; hostId: string; members: RoomMember[] };
type BotDifficulty = "easy" | "normal" | "hard";
type Player = { userId: string; username: string; isBot?: boolean; difficulty?: BotDifficulty };
type Group = "solids" | "stripes" | null;
type Ball = { id: number; x: number; y: number; vx: number; vy: number; pocketed: boolean };
type Shot = { id: string; shooterId: string; angle: number; power: number; startedAt: number };
type Game = { status: "lobby" | "playing" | "gameover"; players: Player[]; turnIndex: number; balls: Ball[]; groups: Record<string, Group>; shot: Shot | null; winnerId: string | null; lastMessage: string | null };
type Aim = { angle: number; power: number };
type AimPrediction = { ballId: number; x: number; y: number; angle: number };
type Simulation = { balls: Ball[]; accumulator: number; elapsed: number };

const BALL_R = 0.013;
const STEP = 1 / 180;
const MAX_SHOT_TIME = 6.5;
const LEFT = 0.032;
const RIGHT = 0.968;
const TOP = 0.032;
const BOTTOM = 0.468;
const POCKET_R = 0.032;
const STOP_SPEED = 0.011;
const POCKETS = [
  { x: 0.035, y: 0.035 }, { x: 0.5, y: 0.025 }, { x: 0.965, y: 0.035 },
  { x: 0.035, y: 0.465 }, { x: 0.5, y: 0.475 }, { x: 0.965, y: 0.465 },
];
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const cloneBalls = (balls: Ball[]) => balls.map((ball) => ({ ...ball }));

function rackBalls(): Ball[] {
  const balls: Ball[] = [{ id: 0, x: 0.255, y: 0.25, vx: 0, vy: 0, pocketed: false }];
  const ids = [1, 9, 2, 10, 8, 3, 11, 4, 12, 5, 13, 6, 14, 7, 15];
  let index = 0;
  for (let row = 0; row < 5; row++) {
    const x = 0.69 + row * 0.024;
    for (let slot = 0; slot <= row; slot++) {
      balls.push({ id: ids[index++], x, y: 0.25 + (slot - row / 2) * 0.0274, vx: 0, vy: 0, pocketed: false });
    }
  }
  return balls;
}

function groupLabel(group: Group) {
  if (group === "solids") return "PLEINES";
  if (group === "stripes") return "RAYÉES";
  return "LIBRE";
}

function predictAimCollision(cue: Ball, balls: Ball[], angle: number): AimPrediction | null {
  const dirX = Math.cos(angle), dirY = Math.sin(angle);
  const collisionRadius = BALL_R * 2;
  const limits: number[] = [];
  if (dirX > 0.000001) limits.push((RIGHT - BALL_R - cue.x) / dirX);
  else if (dirX < -0.000001) limits.push((LEFT + BALL_R - cue.x) / dirX);
  if (dirY > 0.000001) limits.push((BOTTOM - BALL_R - cue.y) / dirY);
  else if (dirY < -0.000001) limits.push((TOP + BALL_R - cue.y) / dirY);
  const railDistance = Math.min(...limits.filter((value) => value > 0));

  let bestDistance = Number.POSITIVE_INFINITY;
  let best: AimPrediction | null = null;
  for (const ball of balls) {
    if (ball.id === 0 || ball.pocketed) continue;
    const relX = ball.x - cue.x, relY = ball.y - cue.y;
    const projection = relX * dirX + relY * dirY;
    if (projection <= 0) continue;
    const perpendicularSquared = relX * relX + relY * relY - projection * projection;
    const radiusSquared = collisionRadius * collisionRadius;
    if (perpendicularSquared > radiusSquared) continue;
    const hitDistance = projection - Math.sqrt(Math.max(0, radiusSquared - perpendicularSquared));
    if (hitDistance <= 0 || hitDistance >= bestDistance || (Number.isFinite(railDistance) && hitDistance > railDistance)) continue;
    const impactX = cue.x + dirX * hitDistance, impactY = cue.y + dirY * hitDistance;
    const normalX = ball.x - impactX, normalY = ball.y - impactY;
    bestDistance = hitDistance;
    best = { ballId: ball.id, x: ball.x, y: ball.y, angle: Math.atan2(normalY, normalX) };
  }
  return best;
}

function respawnCue(balls: Ball[]) {
  const next = cloneBalls(balls);
  const cue = next.find((ball) => ball.id === 0);
  if (!cue || !cue.pocketed) return next;
  const candidates = [{ x: 0.255, y: 0.25 }, { x: 0.22, y: 0.20 }, { x: 0.22, y: 0.30 }, { x: 0.30, y: 0.20 }, { x: 0.30, y: 0.30 }];
  const spot = candidates.find((candidate) => next.every((ball) => ball.id === 0 || ball.pocketed || Math.hypot(ball.x - candidate.x, ball.y - candidate.y) > BALL_R * 2.2)) ?? candidates[0];
  cue.x = spot.x; cue.y = spot.y; cue.vx = 0; cue.vy = 0; cue.pocketed = false;
  return next;
}

function makeSimulation(source: Ball[], shot: Shot): Simulation {
  const balls = cloneBalls(source);
  const cue = balls.find((ball) => ball.id === 0 && !ball.pocketed);
  if (cue) {
    const speed = 0.34 + clamp(shot.power, 0, 1) * 1.25;
    cue.vx = Math.cos(shot.angle) * speed;
    cue.vy = Math.sin(shot.angle) * speed;
  }
  return { balls, accumulator: 0, elapsed: 0 };
}

function stepSimulation(simulation: Simulation) {
  const balls = simulation.balls;
  for (const ball of balls) {
    if (ball.pocketed) continue;
    ball.x += ball.vx * STEP;
    ball.y += ball.vy * STEP;
    for (const pocket of POCKETS) {
      if (Math.hypot(ball.x - pocket.x, ball.y - pocket.y) <= POCKET_R) {
        ball.x = pocket.x; ball.y = pocket.y; ball.vx = 0; ball.vy = 0; ball.pocketed = true; break;
      }
    }
    if (ball.pocketed) continue;
    if (ball.x - BALL_R < LEFT) { ball.x = LEFT + BALL_R; ball.vx = Math.abs(ball.vx) * 0.91; }
    else if (ball.x + BALL_R > RIGHT) { ball.x = RIGHT - BALL_R; ball.vx = -Math.abs(ball.vx) * 0.91; }
    if (ball.y - BALL_R < TOP) { ball.y = TOP + BALL_R; ball.vy = Math.abs(ball.vy) * 0.91; }
    else if (ball.y + BALL_R > BOTTOM) { ball.y = BOTTOM - BALL_R; ball.vy = -Math.abs(ball.vy) * 0.91; }
  }

  for (let ai = 0; ai < balls.length; ai++) {
    const a = balls[ai]; if (a.pocketed) continue;
    for (let bi = ai + 1; bi < balls.length; bi++) {
      const b = balls[bi]; if (b.pocketed) continue;
      let dx = b.x - a.x, dy = b.y - a.y, distance = Math.hypot(dx, dy);
      const minimum = BALL_R * 2;
      if (distance >= minimum) continue;
      if (distance < 0.000001) { dx = minimum; dy = 0; distance = minimum; }
      const nx = dx / distance, ny = dy / distance, overlap = minimum - distance;
      a.x -= nx * overlap * 0.5; a.y -= ny * overlap * 0.5;
      b.x += nx * overlap * 0.5; b.y += ny * overlap * 0.5;
      const relative = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
      if (relative < 0) {
        const impulse = -(1 + 0.94) * relative / 2;
        a.vx -= impulse * nx; a.vy -= impulse * ny;
        b.vx += impulse * nx; b.vy += impulse * ny;
      }
    }
  }

  const friction = Math.pow(0.989, STEP * 60);
  for (const ball of balls) {
    if (ball.pocketed) continue;
    ball.vx *= friction; ball.vy *= friction;
    if (Math.hypot(ball.vx, ball.vy) < STOP_SPEED) { ball.vx = 0; ball.vy = 0; }
  }
  simulation.elapsed += STEP;
}

function advanceSimulation(simulation: Simulation, seconds: number) {
  simulation.accumulator += Math.max(0, Math.min(0.12, seconds));
  let guard = 0;
  while (simulation.accumulator >= STEP && simulation.elapsed < MAX_SHOT_TIME && guard < 2400) {
    stepSimulation(simulation); simulation.accumulator -= STEP; guard++;
  }
  return simulation.elapsed < MAX_SHOT_TIME && simulation.balls.some((ball) => !ball.pocketed && Math.hypot(ball.vx, ball.vy) >= STOP_SPEED);
}

async function post(payload: Record<string, unknown>) {
  const response = await fetch("/api/pool", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload), cache: "no-store" });
  const data = await response.json();
  if (!response.ok || !data.ok) throw new Error(data.error || "Erreur Billard.");
  return data;
}

export default function PoolGame({ room, user }: { room: Room; user: User }) {
  const [game, setGame] = useState<Game | null>(null);
  const [tab, setTab] = useState<"solo" | "duel">("solo");
  const [selectedOpponent, setSelectedOpponent] = useState("");
  const [botDifficulty, setBotDifficulty] = useState<BotDifficulty>("normal");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [focusSuppressed, setFocusSuppressed] = useState(false);
  const [aim, setAim] = useState<Aim | null>(null);
  const [visualBalls, setVisualBalls] = useState<Ball[]>(rackBalls());
  const [soloActive, setSoloActive] = useState(false);
  const [soloBalls, setSoloBalls] = useState<Ball[]>(rackBalls());
  const [soloShot, setSoloShot] = useState<Shot | null>(null);
  const [soloDone, setSoloDone] = useState(false);
  const [soloMessage, setSoloMessage] = useState("Empoche toutes les billes.");
  const tableRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ pointerId: number } | null>(null);
  const resolvedRef = useRef<Set<string>>(new Set());
  const botActionRef = useRef(false);

  const isHost = room.hostId === user.id;
  const onlineMembers = useMemo(() => room.members.filter((member) => member.online), [room.members]);
  const opponents = useMemo(() => onlineMembers.filter((member) => member.id !== user.id), [onlineMembers, user.id]);
  const duelActive = game?.status === "playing" || game?.status === "gameover";
  const active = soloActive || duelActive;
  const activeShot = soloActive ? soloShot : game?.shot ?? null;
  const baseBalls = soloActive ? soloBalls : game?.balls ?? rackBalls();
  const currentPlayer = game?.players[game.turnIndex % Math.max(1, game.players.length)] ?? null;
  const canShoot = soloActive ? !soloDone && !soloShot : game?.status === "playing" && !game.shot && currentPlayer?.userId === user.id;
  const cueBall = visualBalls.find((ball) => ball.id === 0 && !ball.pocketed) ?? baseBalls.find((ball) => ball.id === 0 && !ball.pocketed) ?? null;
  const aimPrediction = cueBall && aim ? predictAimCollision(cueBall, visualBalls, aim.angle) : null;

  useEffect(() => {
    if (!opponents.length) { setSelectedOpponent(""); return; }
    if (!opponents.some((member) => member.id === selectedOpponent)) setSelectedOpponent(opponents[0].id);
  }, [opponents, selectedOpponent]);

  useEffect(() => {
    let alive = true; let timer: number | undefined;
    const poll = async () => {
      if (!alive) return;
      try { const data = await post({ action: "state", code: room.code }); if (alive) { setGame(data.game as Game); setError(""); } }
      catch (pollError) { if (alive && !game) setError(pollError instanceof Error ? pollError.message : "Billard indisponible."); }
      if (alive) timer = window.setTimeout(() => void poll(), duelActive ? 160 : 2200);
    };
    void poll(); return () => { alive = false; if (timer !== undefined) window.clearTimeout(timer); };
  }, [room.code, duelActive]);

  useEffect(() => {
    if (soloActive || game?.shot) return;
    if (duelActive && game?.balls) setVisualBalls(cloneBalls(game.balls));
  }, [soloActive, duelActive, game?.shot?.id, game?.balls]);

  useEffect(() => {
    const handler = () => { if (active) setFocusSuppressed(true); };
    window.addEventListener("retro:return-room", handler);
    return () => window.removeEventListener("retro:return-room", handler);
  }, [active]);

  useEffect(() => {
    document.body.classList.toggle("pool-match-active", active && !focusSuppressed);
    return () => document.body.classList.remove("pool-match-active");
  }, [active, focusSuppressed]);

  useEffect(() => {
    window.dispatchEvent(new CustomEvent("retro:game-active", { detail: active ? "pool" : null }));
  }, [active]);

  useEffect(() => {
    if (!activeShot) return;
    const simulation = makeSimulation(baseBalls, activeShot);
    let raf = 0, previous = performance.now(), finished = false;
    const catchup = Math.max(0, (Date.now() - activeShot.startedAt) / 1000);
    if (catchup > 0) advanceSimulation(simulation, Math.min(catchup, MAX_SHOT_TIME));
    setVisualBalls(cloneBalls(simulation.balls));

    const finish = () => {
      if (finished) return; finished = true;
      const finalBalls = respawnCue(simulation.balls);
      setVisualBalls(cloneBalls(finalBalls));
      if (soloActive) {
        const beforePocketed = new Set(baseBalls.filter((ball) => ball.pocketed).map((ball) => ball.id));
        const newlyPocketed = simulation.balls.filter((ball) => ball.pocketed && !beforePocketed.has(ball.id)).map((ball) => ball.id);
        const remaining = finalBalls.filter((ball) => ball.id !== 0 && !ball.pocketed).length;
        setSoloBalls(cloneBalls(finalBalls)); setSoloShot(null);
        if (remaining === 0) { setSoloDone(true); setSoloMessage("TABLE NETTOYÉE !"); }
        else if (newlyPocketed.includes(0)) setSoloMessage("Blanche empochée · replacée automatiquement.");
        else if (newlyPocketed.some((id) => id !== 0)) { const count = newlyPocketed.filter((id) => id !== 0).length; setSoloMessage(`${count} bille${count > 1 ? "s" : ""} empochée${count > 1 ? "s" : ""}.`); }
        else setSoloMessage("Aucune bille empochée.");
        return;
      }
      const shotPlayer = game?.players.find((player) => player.userId === activeShot.shooterId);
      const canResolve = activeShot.shooterId === user.id || Boolean(isHost && shotPlayer?.isBot);
      if (canResolve && !resolvedRef.current.has(activeShot.id)) {
        resolvedRef.current.add(activeShot.id);
        void post({ action: "resolve", code: room.code, shotId: activeShot.id }).then((data) => setGame(data.game as Game)).catch((resolveError) => setError(resolveError instanceof Error ? resolveError.message : "Impossible de valider le coup."));
      }
    };

    const animate = (now: number) => {
      if (finished) return;
      if (Date.now() < activeShot.startedAt) { previous = now; raf = requestAnimationFrame(animate); return; }
      const moving = advanceSimulation(simulation, Math.min(0.05, Math.max(0, (now - previous) / 1000)));
      previous = now; setVisualBalls(cloneBalls(simulation.balls));
      if (!moving || simulation.elapsed >= MAX_SHOT_TIME) { finish(); return; }
      raf = requestAnimationFrame(animate);
    };
    raf = requestAnimationFrame(animate);
    return () => { finished = true; cancelAnimationFrame(raf); };
  }, [activeShot?.id]);

  useEffect(() => {
    if (!duelActive || game?.status !== "playing" || !isHost || game.shot || !currentPlayer?.isBot) { botActionRef.current = false; return; }
    if (botActionRef.current) return;
    botActionRef.current = true;
    const delay = currentPlayer.difficulty === "easy" ? 850 : currentPlayer.difficulty === "hard" ? 360 : 560;
    const id = window.setTimeout(() => {
      void post({ action: "botShoot", code: room.code }).then((data) => setGame(data.game as Game)).catch((botError) => setError(botError instanceof Error ? botError.message : "Le bot n'a pas pu jouer.")).finally(() => { botActionRef.current = false; });
    }, delay);
    return () => window.clearTimeout(id);
  }, [duelActive, game?.status, game?.turnIndex, game?.shot?.id, currentPlayer?.userId, isHost, room.code]);

  const startSolo = () => {
    const balls = rackBalls(); setSoloBalls(balls); setVisualBalls(cloneBalls(balls)); setSoloShot(null); setSoloDone(false); setSoloMessage("Empoche toutes les billes."); setSoloActive(true); setFocusSuppressed(false); setAim(null);
  };
  const exitSolo = () => { setSoloActive(false); setSoloShot(null); setSoloDone(false); setAim(null); setFocusSuppressed(false); };

  const startDuel = async (opponentId = selectedOpponent, botDifficultyValue: BotDifficulty | null = null) => {
    try { setBusy(true); setError(""); setFocusSuppressed(false); setAim(null); const data = await post({ action: "start", code: room.code, opponentId, botDifficulty: botDifficultyValue }); setGame(data.game as Game); setVisualBalls(cloneBalls(data.game.balls as Ball[])); }
    catch (actionError) { setError(actionError instanceof Error ? actionError.message : "Impossible de lancer le billard."); }
    finally { setBusy(false); }
  };
  const stopDuel = async () => {
    try { setBusy(true); setError(""); const data = await post({ action: "stop", code: room.code }); setGame(data.game as Game); setAim(null); setFocusSuppressed(false); }
    catch (actionError) { setError(actionError instanceof Error ? actionError.message : "Impossible de revenir au lobby."); }
    finally { setBusy(false); }
  };

  const normalizedPointer = (event: PointerEvent<HTMLDivElement>) => {
    const rect = tableRef.current?.getBoundingClientRect(); if (!rect) return null;
    return { x: clamp((event.clientX - rect.left) / rect.width, 0, 1), y: clamp((event.clientY - rect.top) / rect.height * 0.5, 0, 0.5) };
  };
  const pointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (!canShoot || activeShot || !cueBall) return;
    const point = normalizedPointer(event); if (!point || Math.hypot(point.x - cueBall.x, point.y - cueBall.y) > 0.055) return;
    dragRef.current = { pointerId: event.pointerId }; setAim({ angle: 0, power: 0 });
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch {}
  };
  const pointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current || dragRef.current.pointerId !== event.pointerId || !cueBall) return;
    const point = normalizedPointer(event); if (!point) return;
    const dx = cueBall.x - point.x, dy = cueBall.y - point.y;
    setAim({ angle: Math.atan2(dy, dx), power: clamp(Math.hypot(dx, dy) / 0.23, 0, 1) });
  };
  const shoot = async (angle: number, power: number) => {
    setAim(null);
    if (soloActive) { setSoloShot({ id: `solo-pool-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, shooterId: user.id, angle, power, startedAt: Date.now() + 20 }); return; }
    const shotId = `pool-${user.id}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const startedAt = Date.now() + 20;
    const optimistic: Shot = { id: shotId, shooterId: user.id, angle, power, startedAt };
    setGame((current) => current ? { ...current, shot: optimistic, lastMessage: null } : current);
    try { const data = await post({ action: "shoot", code: room.code, angle, power, shotId, startedAt }); setGame(data.game as Game); }
    catch (actionError) { setGame((current) => current?.shot?.id === shotId ? { ...current, shot: null } : current); setError(actionError instanceof Error ? actionError.message : "Coup impossible."); }
  };
  const pointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current || dragRef.current.pointerId !== event.pointerId) return;
    dragRef.current = null; const current = aim;
    try { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); } catch {}
    if (!current || current.power < 0.06) { setAim(null); return; }
    void shoot(current.angle, current.power);
  };

  if (!game) return <section className="poolLobby"><div className="poolLoading"><span>🎱</span><strong>Billard</strong><small>Chargement…</small></div>{error && <div className="errorBox">{error}</div>}</section>;
  if (!duelActive && !soloActive) return <section className="poolLobby">
    <div className="poolHero"><div className="poolHeroIcon">🎱</div><div><span className="kicker">BILLARD · ARCADE</span><h2>Billard</h2><p>Attrape la blanche, tire la queue vers l'arrière, règle ta puissance puis relâche. Collisions, bandes et poches sont physiques.</p></div></div>
    <div className="poolTabs"><button className={tab === "solo" ? "active" : ""} onClick={() => setTab("solo")}><strong>SOLO</strong><small>Nettoie toute la table</small></button><button className={tab === "duel" ? "active" : ""} onClick={() => setTab("duel")}><strong>1 VS 1</strong><small>Règles 8-ball arcade</small></button></div>
    {tab === "solo" ? <div className="poolSetup"><div><strong>Entraînement</strong><small>Empoche les 15 billes. Si la blanche tombe, elle est replacée automatiquement.</small></div><button className="primaryButton" onClick={startSolo}>Jouer en solo</button></div> : <div className="poolSetup"><div><strong>8-ball arcade</strong><small>La première couleur empochée attribue pleines/rayées. Vide ton groupe puis empoche la noire. Si tu mets la noire trop tôt, tu perds.</small></div>{isHost ? <><label><span>Adversaire</span><select value={selectedOpponent} disabled={!opponents.length || busy} onChange={(event) => setSelectedOpponent(event.target.value)}>{opponents.length ? opponents.map((member) => <option key={member.id} value={member.id}>{member.username}</option>) : <option value="">Aucun ami connecté</option>}</select></label><button className="primaryButton" disabled={!selectedOpponent || busy} onClick={() => void startDuel()}>{busy ? "Lancement…" : "Lancer le 1v1"}</button></> : <small className="poolWaiting">En attente de l'hôte…</small>}</div>}
    {tab === "duel" && isHost && <div className="botPlayPanel poolBotPanel"><div><strong>🤖 Jouer contre un bot</strong><small>Le bot vise, dose sa puissance et joue automatiquement à son tour.</small></div><select value={botDifficulty} onChange={(event) => setBotDifficulty(event.target.value as BotDifficulty)}><option value="easy">Facile</option><option value="normal">Normal</option><option value="hard">Difficile</option></select><button disabled={busy} onClick={() => void startDuel("", botDifficulty)}>Lancer vs BOT</button></div>}
    {error && <div className="errorBox">{error}</div>}
  </section>;

  if (focusSuppressed) return <section className="gameInProgressCard poolProgressCard"><div><span className="kicker">BILLARD EN COURS</span><h2>{soloActive ? "Solo en cours" : "1v1 en cours"}</h2><p>La partie continue dans la room.</p></div><button className="primaryButton" onClick={() => setFocusSuppressed(false)}>Revenir au billard</button></section>;

  const winner = game.winnerId ? game.players.find((player) => player.userId === game.winnerId) : null;
  const playerOne = game.players[0], playerTwo = game.players[1];
  const soloPocketed = soloBalls.filter((ball) => ball.id !== 0 && ball.pocketed).length;
  const instruction = activeShot ? "LES BILLES ROULENT…" : canShoot ? "ATTRAPE LA BLANCHE · TIRE VERS L'ARRIÈRE · RELÂCHE" : soloActive ? "PRÉPARE TON COUP" : `AU TOUR DE ${currentPlayer?.username?.toUpperCase() ?? "…"}`;
  const powerClass = !aim ? "" : aim.power < 0.42 ? "low" : aim.power < 0.78 ? "mid" : "high";
  const guideStyle = cueBall && aim ? ({ left: `${cueBall.x * 100}%`, top: `${cueBall.y * 200}%`, transform: `rotate(${aim.angle}rad)` } as CSSProperties) : undefined;
  const predictionStyle = aimPrediction ? ({ left: `${aimPrediction.x * 100}%`, top: `${aimPrediction.y * 200}%`, transform: `rotate(${aimPrediction.angle}rad)` } as CSSProperties) : undefined;
  const pocketRail = (player: Player | undefined) => {
    const group = player ? game.groups[player.userId] ?? null : null;
    const ids = group === "solids" ? [1,2,3,4,5,6,7] : group === "stripes" ? [9,10,11,12,13,14,15] : [];
    const pocketed = new Set((game.balls ?? []).filter((ball) => ball.pocketed).map((ball) => ball.id));
    return Array.from({ length: 7 }, (_, index) => {
      const id = ids[index];
      const assigned = Boolean(id);
      const pocketedBall = Boolean(id && pocketed.has(id));
      return <span key={`${player?.userId ?? "empty"}-${index}`} className={`poolHudBall ${assigned ? `assigned ball-${id}` : ""} ${pocketedBall ? "pocketed" : ""}`}><i>{assigned ? id : ""}</i></span>;
    });
  };

  return <section className="poolGameWrap">
    <div className="poolHud">{soloActive ? <><div><small>MODE</small><strong>SOLO</strong></div><div className="poolHudCenter"><small>EMPOCHÉES</small><strong>{soloPocketed}/15</strong></div><div className="poolHudRight"><small>RESTANTES</small><strong>{15 - soloPocketed}</strong></div></> : <>{playerOne && <div className={`poolPlayerHud ${game.status === "playing" && game.turnIndex === 0 ? "turn" : ""}`}><small>{groupLabel(game.groups[playerOne.userId])}</small><strong>{playerOne.username}</strong><div className="poolHudBalls">{pocketRail(playerOne)}</div></div>}<div className="poolHudCenter"><small>TOUR</small><strong>{currentPlayer?.username ?? "—"}</strong></div>{playerTwo && <div className={`poolPlayerHud right ${game.status === "playing" && game.turnIndex === 1 ? "turn" : ""}`}><small>{groupLabel(game.groups[playerTwo.userId])}</small><strong>{playerTwo.username}</strong><div className="poolHudBalls right">{pocketRail(playerTwo)}</div></div>}</>}</div>
    <div className="poolInstruction"><span>{instruction}</span>{aim && <strong>{Math.round(aim.power * 100)}%</strong>}</div>
    <div ref={tableRef} className={`poolTable ${canShoot ? "canShoot" : ""}`} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={pointerUp}>
      <div className="poolWood"/><div className="poolFelt"/>
      {POCKETS.map((pocket, index) => <span key={index} className="poolPocket" style={{ left: `${pocket.x * 100}%`, top: `${pocket.y * 200}%` }}/>) }
      <div className="poolHeadLine"/><div className="poolHeadSpot"/>
      {[0.25, 0.5, 0.75].map((x) => <i key={`top-${x}`} className="poolDiamond top" style={{ left: `${x * 100}%` }}/>) }
      {[0.25, 0.5, 0.75].map((x) => <i key={`bottom-${x}`} className="poolDiamond bottom" style={{ left: `${x * 100}%` }}/>) }
      {aim && cueBall && !activeShot && <><div className="poolGuide" style={guideStyle}><span/></div>{aimPrediction && <div className="poolTargetPrediction" style={predictionStyle}><i/></div>}<div className={`poolCueWrap ${powerClass}`} style={guideStyle}><div className="poolCueStick" style={{ width: `${150 + aim.power * 150}px`, right: `${22 + aim.power * 72}px` }}/></div></>}
      {visualBalls.filter((ball) => !ball.pocketed).map((ball) => <div key={ball.id} className={`poolBall ball-${ball.id} ${ball.id === 0 ? "cueBall" : ""}`} style={{ left: `${ball.x * 100}%`, top: `${ball.y * 200}%` }}><span>{ball.id === 0 ? "" : ball.id}</span></div>)}
      {aim && <div className={`poolPower ${powerClass}`}><small>PUISSANCE</small><div><i style={{ height: `${Math.max(4, aim.power * 100)}%` }}/></div><strong>{Math.round(aim.power * 100)}</strong></div>}
      {(soloDone || game.status === "gameover") && <div className="poolGameOver"><span>🎱</span><small>{soloDone ? "TABLE NETTOYÉE" : "PARTIE TERMINÉE"}</small><h2>{soloDone ? "Bien joué !" : `${winner?.username ?? "Joueur"} gagne !`}</h2>{soloDone ? <div className="gameEndActions"><button className="primaryButton" onClick={startSolo}>Rejouer</button><button className="secondaryButton" onClick={exitSolo}>Lobby du jeu</button></div> : isHost ? <div className="gameEndActions"><button className="primaryButton" disabled={busy} onClick={() => { const other = game.players.find((player) => player.userId !== user.id); void startDuel(other?.isBot ? "" : other?.userId ?? selectedOpponent, other?.isBot ? other.difficulty ?? botDifficulty : null); }}>Rejouer</button><button className="secondaryButton" disabled={busy} onClick={() => void stopDuel()}>Lobby du jeu</button></div> : <small>En attente de l'hôte…</small>}</div>}
    </div>
    <div className="poolStatusLine">{soloActive ? soloMessage : game.lastMessage ?? "Casse la table et empoche ton groupe."}</div>
    {error && <div className="errorBox poolError">{error}</div>}
  </section>;
}
