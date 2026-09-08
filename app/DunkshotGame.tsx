"use client";

import { CSSProperties, PointerEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

type User = { id: string; username: string };
type RoomMember = { id: string; username: string; online: boolean; joined_at: string };
type Room = { code: string; hostId: string; members: RoomMember[] };
type Player = { userId: string; username: string };
type Shot = { id: string; shooterId: string; power: number; aim: number; startedAt: number };
type LastResult = { shotId: string; shooterId: string; made: boolean; at: number };
type Game = {
  status: "lobby" | "playing" | "gameover";
  players: Player[];
  livesTotal: number;
  lives: Record<string, number>;
  turnIndex: number;
  streak: number;
  shot: Shot | null;
  lastResult: LastResult | null;
  winnerId: string | null;
};
type AimState = { power: number; aim: number };
type BallVisual = { x: number; y: number; rotation: number; visible: boolean };
type SoloRun = { active: boolean; lives: number; score: number; streak: number; gameover: boolean };

type HoopPosition = { x: number; y: number; moving: boolean };

const LIVES_OPTIONS = [1, 2, 3, 5, 7, 10];
const BALL_START_X = 0.5;
const BALL_START_Y = 0.86;
const GRAVITY = 1.95;

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

async function post(payload: Record<string, unknown>) {
  const response = await fetch("/api/dunkshot", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    cache: "no-store",
  });
  const data = await response.json();
  if (!response.ok || !data.ok) throw new Error(data.error || "Erreur Dunkshot.");
  return data;
}

function trajectory(power: number, aim: number, elapsed: number) {
  const initialY = -(1.30 + clamp(power, 0, 1) * 0.55);
  const initialX = clamp(aim, -1, 1) * (0.34 + clamp(power, 0, 1) * 0.10);
  return {
    x: BALL_START_X + initialX * elapsed,
    y: BALL_START_Y + initialY * elapsed + 0.5 * GRAVITY * elapsed * elapsed,
    velocityY: initialY + GRAVITY * elapsed,
  };
}

function hoopPosition(streak: number, now: number): HoopPosition {
  if (streak < 2) return { x: 0.5, y: 0.285, moving: false };
  const horizontalAmplitude = Math.min(0.285, 0.085 + (streak - 2) * 0.018);
  const horizontalSpeed = 0.00105 + Math.min(0.00125, streak * 0.000085);
  const x = 0.5 + horizontalAmplitude * Math.sin(now * horizontalSpeed + streak * 1.43);
  if (streak < 6) return { x, y: 0.285, moving: true };
  const verticalAmplitude = Math.min(0.07, 0.018 + (streak - 6) * 0.006);
  const y = 0.285 + verticalAmplitude * Math.sin(now * (0.0008 + streak * 0.000045) + 0.9);
  return { x, y, moving: true };
}

function hearts(value: number) {
  if (value <= 0) return "♡";
  return "♥".repeat(Math.min(10, value));
}

export default function DunkshotGame({ room, user }: { room: Room; user: User }) {
  const [game, setGame] = useState<Game | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<"solo" | "duel">("solo");
  const [soloLivesTotal, setSoloLivesTotal] = useState(3);
  const [soloRun, setSoloRun] = useState<SoloRun | null>(null);
  const [soloShot, setSoloShot] = useState<Shot | null>(null);
  const [selectedOpponent, setSelectedOpponent] = useState("");
  const [aimState, setAimState] = useState<AimState | null>(null);
  const [ball, setBall] = useState<BallVisual>({ x: BALL_START_X, y: BALL_START_Y, rotation: 0, visible: true });
  const [sceneTime, setSceneTime] = useState(Date.now());
  const [soloMessage, setSoloMessage] = useState<{ text: string; made: boolean; at: number } | null>(null);
  const [focusSuppressed, setFocusSuppressed] = useState(false);

  const courtRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ pointerId: number; startX: number; startY: number } | null>(null);
  const resolvedShotsRef = useRef<Set<string>>(new Set());
  const soloRunRef = useRef<SoloRun | null>(null);

  const isHost = room.hostId === user.id;
  const onlineMembers = useMemo(() => room.members.filter((member) => member.online), [room.members]);
  const opponents = useMemo(() => onlineMembers.filter((member) => member.id !== user.id), [onlineMembers, user.id]);
  const duelActive = game?.status === "playing" || game?.status === "gameover";
  const soloActive = Boolean(soloRun?.active);
  const active = duelActive || soloActive;
  const currentPlayer = game?.players[game.turnIndex % Math.max(1, game.players.length)] ?? null;
  const canShootDuel = game?.status === "playing" && !game.shot && currentPlayer?.userId === user.id;
  const canShootSolo = Boolean(soloRun?.active && !soloRun.gameover && !soloShot);
  const canShoot = canShootSolo || canShootDuel;
  const activeShot = soloActive ? soloShot : game?.shot ?? null;
  const activeStreak = soloActive ? soloRun?.streak ?? 0 : game?.streak ?? 0;
  const hoop = hoopPosition(activeStreak, sceneTime);

  useEffect(() => { soloRunRef.current = soloRun; }, [soloRun]);

  useEffect(() => {
    if (!opponents.length) { setSelectedOpponent(""); return; }
    if (!opponents.some((member) => member.id === selectedOpponent)) setSelectedOpponent(opponents[0].id);
  }, [opponents, selectedOpponent]);

  useEffect(() => {
    let alive = true;
    let timer: number | undefined;
    const poll = async () => {
      if (!alive) return;
      try {
        const data = await post({ action: "state", code: room.code });
        if (alive) { setGame(data.game as Game); setError(""); }
      } catch (pollError) {
        if (alive && !game) setError(pollError instanceof Error ? pollError.message : "Dunkshot indisponible.");
      }
      if (alive) timer = window.setTimeout(() => void poll(), duelActive ? 280 : 900);
    };
    void poll();
    return () => { alive = false; if (timer !== undefined) window.clearTimeout(timer); };
  }, [room.code, duelActive]);

  useEffect(() => {
    if (!active) return;
    let raf = 0;
    const tick = () => { setSceneTime(Date.now()); raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active]);

  useEffect(() => {
    const handler = () => { if (active) setFocusSuppressed(true); };
    window.addEventListener("retro:return-room", handler);
    return () => window.removeEventListener("retro:return-room", handler);
  }, [active]);

  useEffect(() => {
    document.body.classList.toggle("dunkshot-match-active", active && !focusSuppressed);
    return () => document.body.classList.remove("dunkshot-match-active");
  }, [active, focusSuppressed]);

  useEffect(() => {
    if (!activeShot || resolvedShotsRef.current.has(activeShot.id)) return;
    let raf = 0;
    let stopped = false;
    let lastY = BALL_START_Y;
    let made = false;
    const shotStreak = activeStreak;

    setBall({ x: BALL_START_X, y: BALL_START_Y, rotation: 0, visible: true });

    const finishSolo = (didMake: boolean) => {
      const current = soloRunRef.current;
      if (!current || !current.active) return;
      if (didMake) {
        const next = { ...current, score: current.score + 1, streak: current.streak + 1 };
        setSoloRun(next);
        setSoloMessage({ text: "PANIER !", made: true, at: Date.now() });
      } else {
        const lives = Math.max(0, current.lives - 1);
        const next = { ...current, lives, streak: 0, gameover: lives <= 0 };
        setSoloRun(next);
        setSoloMessage({ text: lives <= 0 ? "TERMINÉ" : "RATÉ !", made: false, at: Date.now() });
      }
      window.setTimeout(() => {
        setSoloShot(null);
        setBall({ x: BALL_START_X, y: BALL_START_Y, rotation: 0, visible: true });
      }, 420);
    };

    const resolveDuel = async (didMake: boolean) => {
      if (activeShot.shooterId !== user.id) return;
      try {
        const data = await post({ action: "resolve", code: room.code, shotId: activeShot.id, made: didMake });
        setGame(data.game as Game);
      } catch (resolveError) {
        setError(resolveError instanceof Error ? resolveError.message : "Impossible de valider le tir.");
      }
    };

    const animate = () => {
      if (stopped) return;
      const now = Date.now();
      if (now < activeShot.startedAt) {
        raf = requestAnimationFrame(animate);
        return;
      }
      const elapsed = (now - activeShot.startedAt) / 1000;
      const point = trajectory(activeShot.power, activeShot.aim, elapsed);
      const currentHoop = hoopPosition(shotStreak, now);
      setBall({ x: point.x, y: point.y, rotation: elapsed * 620 * (activeShot.aim >= 0 ? 1 : -1), visible: true });

      const rimY = currentHoop.y + 0.065;
      if (!made && lastY < rimY && point.y >= rimY && point.velocityY > 0 && Math.abs(point.x - currentHoop.x) <= 0.071) made = true;
      lastY = point.y;

      if (elapsed >= 2.15 || (elapsed > 0.55 && point.y > 1.14) || Math.abs(point.x) > 1.28) {
        resolvedShotsRef.current.add(activeShot.id);
        stopped = true;
        window.setTimeout(() => {
          if (soloActive) finishSolo(made);
          else void resolveDuel(made);
        }, 140);
        return;
      }
      raf = requestAnimationFrame(animate);
    };

    raf = requestAnimationFrame(animate);
    return () => { stopped = true; cancelAnimationFrame(raf); };
  }, [activeShot?.id, activeStreak, room.code, soloActive, user.id]);

  useEffect(() => {
    if (!game?.lastResult) return;
    const shooter = game.players.find((player) => player.userId === game.lastResult?.shooterId)?.username ?? "Joueur";
    if (Date.now() - game.lastResult.at < 1800) {
      setSoloMessage({ text: game.lastResult.made ? `${shooter} : PANIER !` : `${shooter} : RATÉ !`, made: game.lastResult.made, at: game.lastResult.at });
    }
  }, [game?.lastResult?.shotId]);

  const configureLives = async (livesTotal: number) => {
    try {
      setBusy(true); setError("");
      const data = await post({ action: "configure", code: room.code, livesTotal });
      setGame(data.game as Game);
    } catch (actionError) { setError(actionError instanceof Error ? actionError.message : "Erreur."); }
    finally { setBusy(false); }
  };

  const startSolo = () => {
    const next = { active: true, lives: soloLivesTotal, score: 0, streak: 0, gameover: false };
    setSoloRun(next); soloRunRef.current = next;
    setSoloShot(null); setSoloMessage(null); setFocusSuppressed(false); setAimState(null);
    setBall({ x: BALL_START_X, y: BALL_START_Y, rotation: 0, visible: true });
  };

  const exitSolo = () => {
    setSoloRun(null); soloRunRef.current = null; setSoloShot(null); setAimState(null); setSoloMessage(null); setFocusSuppressed(false);
    setBall({ x: BALL_START_X, y: BALL_START_Y, rotation: 0, visible: true });
  };

  const startDuel = async (opponentId = selectedOpponent) => {
    try {
      setBusy(true); setError(""); setFocusSuppressed(false); setAimState(null);
      const data = await post({ action: "start", code: room.code, opponentId });
      setGame(data.game as Game);
    } catch (actionError) { setError(actionError instanceof Error ? actionError.message : "Impossible de lancer Dunkshot."); }
    finally { setBusy(false); }
  };

  const stopDuel = async () => {
    try {
      setBusy(true); setError(""); setFocusSuppressed(false);
      const data = await post({ action: "stop", code: room.code });
      setGame(data.game as Game); setAimState(null);
    } catch (actionError) { setError(actionError instanceof Error ? actionError.message : "Impossible de revenir au lobby Dunkshot."); }
    finally { setBusy(false); }
  };

  const shoot = async (power: number, aim: number) => {
    setAimState(null);
    if (soloActive) {
      const shot: Shot = { id: `solo-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, shooterId: user.id, power, aim, startedAt: Date.now() + 70 };
      setSoloShot(shot);
      return;
    }
    try {
      const data = await post({ action: "shoot", code: room.code, power, aim });
      setGame(data.game as Game);
    } catch (actionError) { setError(actionError instanceof Error ? actionError.message : "Tir impossible."); }
  };

  const normalizedPointer = (event: PointerEvent<HTMLDivElement>) => {
    const rect = courtRef.current?.getBoundingClientRect();
    if (!rect) return null;
    return { x: (event.clientX - rect.left) / rect.width, y: (event.clientY - rect.top) / rect.height };
  };

  const pointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (!canShoot || activeShot) return;
    const point = normalizedPointer(event); if (!point) return;
    if (Math.hypot(point.x - BALL_START_X, point.y - BALL_START_Y) > 0.16) return;
    dragRef.current = { pointerId: event.pointerId, startX: point.x, startY: point.y };
    setAimState({ power: 0, aim: 0 });
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch {}
  };

  const pointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current; if (!drag || drag.pointerId !== event.pointerId) return;
    const point = normalizedPointer(event); if (!point) return;
    const power = clamp((point.y - drag.startY) / 0.30, 0, 1);
    const aim = clamp((point.x - drag.startX) / 0.24, -1, 1);
    setAimState({ power, aim });
  };

  const pointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current; if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    const currentAim = aimState;
    try { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); } catch {}
    if (!currentAim || currentAim.power < 0.10) { setAimState(null); return; }
    void shoot(currentAim.power, currentAim.aim);
  };

  if (!game) return <section className="dunkLobby"><div className="dunkLoading"><span>🏀</span><strong>Dunkshot</strong><small>Chargement…</small></div>{error && <div className="errorBox">{error}</div>}</section>;

  if (!duelActive && !soloActive) {
    return <section className="dunkLobby">
      <div className="dunkHero">
        <div className="dunkHeroBall">🏀</div>
        <div><span className="kicker">ARCADE · BASKET</span><h2>Dunkshot</h2><p>Tire vers le bas pour charger la puissance, vise avec les côtés et relâche pour shooter.</p></div>
      </div>
      <div className="dunkModeTabs">
        <button className={tab === "solo" ? "active" : ""} onClick={() => setTab("solo")}><strong>SOLO</strong><small>Enchaîne les paniers</small></button>
        <button className={tab === "duel" ? "active" : ""} onClick={() => setTab("duel")}><strong>1 VS 1</strong><small>Chacun son tour</small></button>
      </div>
      {tab === "solo" ? <div className="dunkSetupPanel">
        <div><strong>Mode survie</strong><small>À partir de 2 paniers d'affilée, le panier commence à bouger. Plus ta série monte, plus ça accélère.</small></div>
        <label><span>Vies</span><select value={soloLivesTotal} onChange={(event) => setSoloLivesTotal(Number(event.target.value))}>{LIVES_OPTIONS.map((value) => <option key={value} value={value}>{value} vie{value > 1 ? "s" : ""}</option>)}</select></label>
        <button className="primaryButton" onClick={startSolo}>Jouer en solo</button>
      </div> : <div className="dunkSetupPanel">
        <div><strong>Duel à élimination</strong><small>Vous tirez chacun votre tour. Un raté retire une vie. À 0 vie, c'est perdu.</small></div>
        <label><span>Vies</span><select value={game.livesTotal} disabled={!isHost || busy} onChange={(event) => void configureLives(Number(event.target.value))}>{LIVES_OPTIONS.map((value) => <option key={value} value={value}>{value} vie{value > 1 ? "s" : ""}</option>)}</select></label>
        {isHost ? <>
          <label><span>Adversaire</span><select value={selectedOpponent} disabled={!opponents.length || busy} onChange={(event) => setSelectedOpponent(event.target.value)}>{opponents.map((member) => <option key={member.id} value={member.id}>{member.username}</option>)}</select></label>
          <button className="primaryButton" disabled={!selectedOpponent || busy} onClick={() => void startDuel()}>{busy ? "Lancement…" : "Lancer le 1v1"}</button>
        </> : <small className="dunkWaiting">En attente de l'hôte…</small>}
      </div>}
      {error && <div className="errorBox">{error}</div>}
    </section>;
  }

  if (focusSuppressed) return <section className="gameInProgressCard dunkProgressCard"><div><span className="kicker">DUNKSHOT EN COURS</span><h2>{soloActive ? "Solo en cours" : "1v1 en cours"}</h2><p>La partie est toujours active.</p></div><button className="primaryButton" onClick={() => setFocusSuppressed(false)}>Revenir au match</button></section>;

  const winner = game.winnerId ? game.players.find((player) => player.userId === game.winnerId) : null;
  const soloGameover = Boolean(soloRun?.gameover);
  const duelGameover = game.status === "gameover";
  const instruction = activeShot ? "TIR EN COURS…" : canShoot ? "TIRE LA BALLE VERS LE BAS" : soloActive ? "PRÉPARE TON PROCHAIN TIR" : `AU TOUR DE ${currentPlayer?.username?.toUpperCase() ?? "…"}`;
  const recentMessage = soloMessage && sceneTime - soloMessage.at < 1800 ? soloMessage : null;
  const arrowStyle = aimState ? ({ height: `${42 + aimState.power * 170}px`, transform: `translateX(-50%) rotate(${aimState.aim * 28}deg)` } as CSSProperties) : undefined;
  const hoopStyle = { left: `${hoop.x * 100}%`, top: `${hoop.y * 100}%` } as CSSProperties;
  const ballStyle = { left: `${ball.x * 100}%`, top: `${ball.y * 100}%`, transform: `translate(-50%,-50%) rotate(${ball.rotation}deg)`, opacity: ball.visible ? 1 : 0 } as CSSProperties;

  return <section className="dunkGameWrap">
    <div className="dunkHud">
      {soloActive ? <>
        <div><small>SCORE</small><strong>{soloRun?.score ?? 0}</strong></div>
        <div className="dunkHudCenter"><small>SÉRIE</small><strong>×{soloRun?.streak ?? 0}</strong></div>
        <div className="dunkLives"><small>VIES</small><strong>{hearts(soloRun?.lives ?? 0)}</strong></div>
      </> : <>
        {game.players[0] && <div className={`dunkPlayerHud ${game.status === "playing" && game.turnIndex === 0 ? "turn" : ""}`}><small>JOUEUR 1</small><strong>{game.players[0].username}</strong><span>{hearts(game.lives[game.players[0].userId] ?? game.livesTotal)}</span></div>}
        <div className="dunkHudCenter"><small>SÉRIE</small><strong>×{game.streak}</strong></div>
        {game.players[1] && <div className={`dunkPlayerHud ${game.status === "playing" && game.turnIndex === 1 ? "turn" : ""}`}><small>JOUEUR 2</small><strong>{game.players[1].username}</strong><span>{hearts(game.lives[game.players[1].userId] ?? game.livesTotal)}</span></div>}
      </>}
    </div>

    <div className="dunkInstruction"><span>{instruction}</span>{aimState && <strong>{Math.round(aimState.power * 100)}%</strong>}</div>

    <div ref={courtRef} className={`dunkCourt ${canShoot ? "canShoot" : ""}`} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={pointerUp}>
      <div className="dunkSkyGlow"/>
      <div className="dunkFloor"><i/><i/><i/><i/></div>
      <div className={`dunkHoop ${hoop.moving ? "moving" : ""}`} style={hoopStyle}>
        <div className="dunkBackboard"/>
        <div className="dunkRim"/>
        <div className="dunkNet"><i/><i/><i/><i/></div>
      </div>
      {aimState && !activeShot && <div className="dunkAimArrow" style={arrowStyle}><span/><b>▲</b></div>}
      <div className="dunkBall" style={ballStyle}><span>🏀</span></div>
      {recentMessage && <div className={`dunkResultFlash ${recentMessage.made ? "made" : "miss"}`}>{recentMessage.text}</div>}
      {(soloGameover || duelGameover) && <div className="dunkGameOver">
        <span className="dunkTrophy">{soloGameover ? "🏀" : "🏆"}</span>
        <small>{soloGameover ? "PARTIE TERMINÉE" : "DUEL TERMINÉ"}</small>
        <h2>{soloGameover ? `${soloRun?.score ?? 0} panier${(soloRun?.score ?? 0) > 1 ? "s" : ""}` : `${winner?.username ?? "Joueur"} gagne !`}</h2>
        {soloGameover ? <div className="gameEndActions"><button className="primaryButton" onClick={startSolo}>Rejouer</button><button className="secondaryButton" onClick={exitSolo}>Lobby du jeu</button></div> : isHost ? <div className="gameEndActions"><button className="primaryButton" disabled={busy} onClick={() => void startDuel(game.players.find((player) => player.userId !== user.id)?.userId ?? selectedOpponent)}>Rejouer</button><button className="secondaryButton" disabled={busy} onClick={() => void stopDuel()}>Lobby du jeu</button></div> : <small>En attente de l'hôte…</small>}
      </div>}
    </div>
    <p className="dunkHint">Maintiens la balle, tire vers le bas pour charger, décale à gauche/droite pour viser puis relâche.</p>
    {error && <div className="errorBox dunkError">{error}</div>}
  </section>;
}
