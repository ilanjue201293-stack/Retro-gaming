"use client";

import { CSSProperties, PointerEvent, useEffect, useMemo, useRef, useState } from "react";
import { DUNK_BALL_START_X, DUNK_BALL_START_Y, buildDunkTrajectory, dunkHoopPosition, dunkSnapshotAt, type DunkShot, type DunkSnapshot } from "@/lib/dunkshot-physics";

type User = { id: string; username: string };
type RoomMember = { id: string; username: string; online: boolean; joined_at: string };
type Room = { code: string; hostId: string; members: RoomMember[] };
type BotDifficulty = "easy" | "normal" | "hard";
type Player = { userId: string; username: string; isBot?: boolean; difficulty?: BotDifficulty };
type LastResult = { shotId: string; shooterId: string; made: boolean; at: number };
type Game = {
  status: "lobby" | "playing" | "gameover";
  players: Player[];
  livesTotal: number;
  lives: Record<string, number>;
  turnIndex: number;
  streak: number;
  shot: DunkShot | null;
  lastResult: LastResult | null;
  winnerId: string | null;
  timeLimitSec: number;
  startedAt: number | null;
  endsAt: number | null;
};
type AimState = { power: number; aim: number };
type SoloRun = { active: boolean; lives: number; score: number; streak: number; gameover: boolean; startedAt: number; endsAt: number | null };
type BallVisual = DunkSnapshot & { visible: boolean };

const LIVES_OPTIONS = [1, 2, 3, 5, 7, 10];
const TIME_OPTIONS = [0, 30, 60, 90, 120, 180, 300];
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const restBall = (): BallVisual => ({ x: DUNK_BALL_START_X, y: DUNK_BALL_START_Y, rotation: 0, inside: false, bounceCount: 0, made: false, done: false, visible: true });
const formatClock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.max(0, seconds % 60)).padStart(2, "0")}`;
const timeLabel = (seconds: number) => seconds === 0 ? "Désactivé" : seconds < 60 ? `${seconds}s` : `${seconds / 60} min`;
const hearts = (value: number) => value <= 0 ? "♡" : "♥".repeat(Math.min(10, value));

async function post(payload: Record<string, unknown>) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 6000);
  try {
    const response = await fetch("/api/dunkshot", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload), cache: "no-store", signal: controller.signal });
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.error || "Erreur Dunkshot.");
    return data;
  } finally { window.clearTimeout(timeout); }
}

export default function DunkshotGame({ room, user }: { room: Room; user: User }) {
  const [game, setGame] = useState<Game | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<"solo" | "duel">("solo");
  const [soloLivesTotal, setSoloLivesTotal] = useState(3);
  const [soloTimeLimitSec, setSoloTimeLimitSec] = useState(0);
  const [soloRun, setSoloRun] = useState<SoloRun | null>(null);
  const [soloShot, setSoloShot] = useState<DunkShot | null>(null);
  const [selectedOpponent, setSelectedOpponent] = useState("");
  const [botDifficulty, setBotDifficulty] = useState<BotDifficulty>("normal");
  const [aimState, setAimState] = useState<AimState | null>(null);
  const [ball, setBall] = useState<BallVisual>(restBall);
  const [sceneTime, setSceneTime] = useState(Date.now());
  const [resultMessage, setResultMessage] = useState<{ text: string; made: boolean; at: number } | null>(null);
  const [focusSuppressed, setFocusSuppressed] = useState(false);

  const courtRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ pointerId: number; startX: number; startY: number } | null>(null);
  const resolvedShotsRef = useRef<Set<string>>(new Set());
  const soloRunRef = useRef<SoloRun | null>(null);
  const gameRef = useRef<Game | null>(null);
  const botBusyRef = useRef(false);

  const isHost = room.hostId === user.id;
  const onlineMembers = useMemo(() => room.members.filter((member) => member.online), [room.members]);
  const opponents = useMemo(() => onlineMembers.filter((member) => member.id !== user.id), [onlineMembers, user.id]);
  const duelActive = game?.status === "playing" || game?.status === "gameover";
  const soloActive = Boolean(soloRun?.active);
  const active = duelActive || soloActive;
  const currentPlayer = game?.players[game.turnIndex % Math.max(1, game.players.length)] ?? null;
  const canShootDuel = game?.status === "playing" && !game.shot && currentPlayer?.userId === user.id && !currentPlayer?.isBot;
  const canShootSolo = Boolean(soloRun?.active && !soloRun.gameover && !soloShot);
  const canShoot = canShootSolo || canShootDuel;
  const activeShot = soloActive ? soloShot : game?.shot ?? null;
  const activeStreak = soloActive ? soloRun?.streak ?? 0 : game?.streak ?? 0;
  const hoop = dunkHoopPosition(activeStreak, sceneTime);

  useEffect(() => { soloRunRef.current = soloRun; }, [soloRun]);
  useEffect(() => { gameRef.current = game; }, [game]);

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
        if (alive && !gameRef.current) setError(pollError instanceof Error ? pollError.message : "Dunkshot indisponible.");
      }
      if (alive) timer = window.setTimeout(() => void poll(), gameRef.current?.status === "playing" ? 180 : 900);
    };
    void poll();
    return () => { alive = false; if (timer !== undefined) window.clearTimeout(timer); };
  }, [room.code]);

  useEffect(() => {
    if (!isHost || game?.status !== "playing" || !game.players.some((player) => player.isBot)) return;
    const id = window.setInterval(async () => {
      if (botBusyRef.current || document.visibilityState !== "visible") return;
      botBusyRef.current = true;
      try {
        const data = await post({ action: "botTick", code: room.code });
        if (data.game) setGame(data.game as Game);
      } catch {} finally { botBusyRef.current = false; }
    }, 330);
    return () => window.clearInterval(id);
  }, [game?.status, isHost, room.code, game?.players.map((player) => player.userId).join("|")]);

  useEffect(() => {
    if (!active) return;
    let raf = 0, lastPaint = 0;
    const tick = (stamp: number) => {
      if (stamp - lastPaint >= 30) { lastPaint = stamp; setSceneTime(Date.now()); }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active]);

  useEffect(() => {
    const current = soloRunRef.current;
    if (!current?.active || current.gameover || !current.endsAt || sceneTime < current.endsAt || soloShot) return;
    const next = { ...current, gameover: true };
    soloRunRef.current = next; setSoloRun(next); setAimState(null);
    setResultMessage({ text: "TEMPS ÉCOULÉ", made: false, at: Date.now() });
  }, [sceneTime, soloShot]);

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
    const trajectory = buildDunkTrajectory(activeShot, activeStreak);
    let raf = 0;
    let stopped = false;
    setBall(restBall());

    const finishSolo = () => {
      const current = soloRunRef.current;
      if (!current?.active) return;
      if (trajectory.made) {
        const next = { ...current, score: current.score + 1, streak: current.streak + 1 };
        soloRunRef.current = next; setSoloRun(next); setResultMessage({ text: "PANIER !", made: true, at: Date.now() });
      } else {
        const lives = Math.max(0, current.lives - 1);
        const next = { ...current, lives, streak: 0, gameover: lives <= 0 };
        soloRunRef.current = next; setSoloRun(next); setResultMessage({ text: lives <= 0 ? "TERMINÉ" : "RATÉ !", made: false, at: Date.now() });
      }
      window.setTimeout(() => { setSoloShot(null); setBall(restBall()); }, 320);
    };

    const animate = () => {
      if (stopped) return;
      const now = Date.now();
      if (now < activeShot.startedAt) { raf = requestAnimationFrame(animate); return; }
      const elapsed = (now - activeShot.startedAt) / 1000;
      const snapshot = dunkSnapshotAt(trajectory, elapsed);
      setBall({ ...snapshot, visible: true });
      if (snapshot.done || elapsed >= trajectory.duration) {
        resolvedShotsRef.current.add(activeShot.id);
        stopped = true;
        if (soloActive) finishSolo();
        else if (activeShot.shooterId === user.id) void post({ action: "resolve", code: room.code, shotId: activeShot.id }).then((data) => setGame(data.game as Game)).catch(() => undefined);
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
    if (Date.now() - game.lastResult.at < 1800) setResultMessage({ text: game.lastResult.made ? `${shooter} : PANIER !` : `${shooter} : RATÉ !`, made: game.lastResult.made, at: game.lastResult.at });
  }, [game?.lastResult?.shotId]);

  const configureSettings = async (livesTotal: number, timeLimitSec: number) => {
    try { setBusy(true); setError(""); const data = await post({ action: "configure", code: room.code, livesTotal, timeLimitSec }); setGame(data.game as Game); }
    catch (actionError) { setError(actionError instanceof Error ? actionError.message : "Erreur."); }
    finally { setBusy(false); }
  };

  const startSolo = () => {
    const startedAt = Date.now();
    const next: SoloRun = { active: true, lives: soloLivesTotal, score: 0, streak: 0, gameover: false, startedAt, endsAt: soloTimeLimitSec > 0 ? startedAt + soloTimeLimitSec * 1000 : null };
    setSoloRun(next); soloRunRef.current = next; resolvedShotsRef.current.clear(); setSoloShot(null); setResultMessage(null); setFocusSuppressed(false); setAimState(null); setBall(restBall());
  };

  const exitSolo = () => { setSoloRun(null); soloRunRef.current = null; setSoloShot(null); setAimState(null); setResultMessage(null); setFocusSuppressed(false); setBall(restBall()); };

  const startDuel = async (opponentId = selectedOpponent) => {
    try { setBusy(true); setError(""); setFocusSuppressed(false); setAimState(null); const data = await post({ action: "start", code: room.code, opponentId }); resolvedShotsRef.current.clear(); setGame(data.game as Game); setBall(restBall()); }
    catch (actionError) { setError(actionError instanceof Error ? actionError.message : "Impossible de lancer Dunkshot."); }
    finally { setBusy(false); }
  };

  const startBot = async () => {
    try { setBusy(true); setError(""); setFocusSuppressed(false); setAimState(null); const data = await post({ action: "startBot", code: room.code, botDifficulty }); resolvedShotsRef.current.clear(); setGame(data.game as Game); setBall(restBall()); }
    catch (actionError) { setError(actionError instanceof Error ? actionError.message : "Impossible d'ajouter le bot."); }
    finally { setBusy(false); }
  };

  const stopDuel = async () => {
    try { setBusy(true); setError(""); setFocusSuppressed(false); const data = await post({ action: "stop", code: room.code }); setGame(data.game as Game); setAimState(null); setBall(restBall()); }
    catch (actionError) { setError(actionError instanceof Error ? actionError.message : "Impossible de revenir au lobby Dunkshot."); }
    finally { setBusy(false); }
  };

  const shoot = async (power: number, aim: number) => {
    setAimState(null);
    if (soloActive) {
      setSoloShot({ id: `solo-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, shooterId: user.id, power, aim, startedAt: Date.now() + 35 });
      return;
    }
    const shotId = `dunk-${user.id}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const startedAt = Date.now() + 45;
    const optimistic: DunkShot = { id: shotId, shooterId: user.id, power, aim, startedAt };
    setGame((current) => current ? { ...current, shot: optimistic, lastResult: null } : current);
    try { const data = await post({ action: "shoot", code: room.code, power, aim, shotId, startedAt }); setGame(data.game as Game); }
    catch (actionError) { setGame((current) => current?.shot?.id === shotId ? { ...current, shot: null } : current); setError(actionError instanceof Error ? actionError.message : "Tir impossible."); }
  };

  const normalizedPointer = (event: PointerEvent<HTMLDivElement>) => {
    const rect = courtRef.current?.getBoundingClientRect();
    if (!rect) return null;
    return { x: (event.clientX - rect.left) / rect.width, y: (event.clientY - rect.top) / rect.height };
  };

  const pointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (!canShoot || activeShot) return;
    const point = normalizedPointer(event); if (!point) return;
    if (Math.hypot(point.x - DUNK_BALL_START_X, point.y - DUNK_BALL_START_Y) > 0.17) return;
    dragRef.current = { pointerId: event.pointerId, startX: point.x, startY: point.y };
    setAimState({ power: 0, aim: 0 });
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch {}
  };

  const pointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current; if (!drag || drag.pointerId !== event.pointerId) return;
    const point = normalizedPointer(event); if (!point) return;
    const power = clamp((point.y - drag.startY) / 0.24, 0, 1);
    const aim = clamp((drag.startX - point.x) / 0.28, -1, 1);
    setAimState({ power, aim });
  };

  const pointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current; if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    const currentAim = aimState;
    try { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); } catch {}
    if (!currentAim || currentAim.power < 0.09) { setAimState(null); return; }
    void shoot(currentAim.power, currentAim.aim);
  };

  if (!game) return <section className="dunkLobby"><div className="dunkLoading"><span>🏀</span><strong>Dunkshot</strong><small>Chargement…</small></div>{error && <div className="errorBox">{error}</div>}</section>;

  if (!duelActive && !soloActive) return <section className="dunkLobby">
    <div className="dunkHero"><div className="dunkHeroBall">🏀</div><div><span className="kicker">ARCADE · BASKET</span><h2>Dunkshot</h2><p>Tire vers le bas pour charger. La trajectoire affichée et le résultat utilisent maintenant exactement le même moteur physique.</p></div></div>
    <div className="dunkModeTabs"><button className={tab === "solo" ? "active" : ""} onClick={() => setTab("solo")}><strong>SOLO</strong><small>Enchaîne les paniers</small></button><button className={tab === "duel" ? "active" : ""} onClick={() => setTab("duel")}><strong>1 VS 1</strong><small>Humain ou bot</small></button></div>
    {tab === "solo" ? <div className="dunkSetupPanel">
      <div><strong>Mode survie</strong><small>À partir de 2 paniers d'affilée, le panier commence à bouger.</small></div>
      <label><span>Vies</span><select value={soloLivesTotal} onChange={(event) => setSoloLivesTotal(Number(event.target.value))}>{LIVES_OPTIONS.map((value) => <option key={value} value={value}>{value} vie{value > 1 ? "s" : ""}</option>)}</select></label>
      <label><span>Timer</span><select value={soloTimeLimitSec} onChange={(event) => setSoloTimeLimitSec(Number(event.target.value))}>{TIME_OPTIONS.map((value) => <option key={value} value={value}>{timeLabel(value)}</option>)}</select></label>
      <button className="primaryButton" onClick={startSolo}>Jouer en solo</button>
    </div> : <div className="dunkSetupPanel dunkSetupV2">
      <div><strong>Duel à élimination</strong><small>Un raté retire une vie. Le bot difficile vise maintenant beaucoup mieux sans être parfait.</small></div>
      <label><span>Vies</span><select value={game.livesTotal} disabled={!isHost || busy} onChange={(event) => void configureSettings(Number(event.target.value), game.timeLimitSec)}>{LIVES_OPTIONS.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
      <label><span>Timer</span><select value={game.timeLimitSec} disabled={!isHost || busy} onChange={(event) => void configureSettings(game.livesTotal, Number(event.target.value))}>{TIME_OPTIONS.map((value) => <option key={value} value={value}>{timeLabel(value)}</option>)}</select></label>
      {isHost && <><label><span>Adversaire</span><select value={selectedOpponent} disabled={!opponents.length || busy} onChange={(event) => setSelectedOpponent(event.target.value)}><option value="">Choisir…</option>{opponents.map((member) => <option key={member.id} value={member.id}>{member.username}</option>)}</select></label><button className="primaryButton" disabled={!selectedOpponent || busy} onClick={() => void startDuel()}>Lancer le 1v1</button><label><span>BOT</span><select value={botDifficulty} onChange={(event) => setBotDifficulty(event.target.value as BotDifficulty)}><option value="easy">Facile</option><option value="normal">Normal</option><option value="hard">Difficile</option></select></label><button className="secondaryButton" disabled={busy} onClick={() => void startBot()}>🤖 Jouer vs BOT</button></>}
      {!isHost && <small className="dunkWaiting">En attente de l'hôte…</small>}
    </div>}
    {error && <div className="errorBox">{error}</div>}
  </section>;

  if (focusSuppressed) return <section className="gameInProgressCard dunkProgressCard"><div><span className="kicker">DUNKSHOT EN COURS</span><h2>{soloActive ? "Solo en cours" : "1v1 en cours"}</h2><p>La partie est toujours active.</p></div><button className="primaryButton" onClick={() => setFocusSuppressed(false)}>Revenir au match</button></section>;

  const winner = game.winnerId ? game.players.find((player) => player.userId === game.winnerId) : null;
  const soloGameover = Boolean(soloRun?.gameover), duelGameover = game.status === "gameover";
  const instruction = activeShot ? "TIR EN COURS…" : canShoot ? "TIRE VERS LE BAS · GLISSE À L'OPPOSÉ POUR VISER" : soloActive ? "PRÉPARE TON PROCHAIN TIR" : currentPlayer?.isBot ? "LE BOT PRÉPARE SON TIR…" : `AU TOUR DE ${currentPlayer?.username?.toUpperCase() ?? "…"}`;
  const recentMessage = resultMessage && sceneTime - resultMessage.at < 1800 ? resultMessage : null;
  const timerSeconds = soloActive ? (soloRun?.endsAt ? Math.max(0, Math.ceil((soloRun.endsAt - sceneTime) / 1000)) : null) : (game.timeLimitSec > 0 && game.endsAt ? Math.max(0, Math.ceil((game.endsAt - sceneTime) / 1000)) : null);
  const arenaClock = timerSeconds === null ? "--:--" : formatClock(timerSeconds);
  const homeValue = soloActive ? soloRun?.score ?? 0 : game.players[0] ? game.lives[game.players[0].userId] ?? game.livesTotal : 0;
  const awayValue = soloActive ? soloRun?.lives ?? 0 : game.players[1] ? game.lives[game.players[1].userId] ?? game.livesTotal : 0;
  const powerClass = !aimState ? "" : aimState.power < 0.40 ? "low" : aimState.power < 0.78 ? "mid" : "high";
  const arrowStyle = aimState ? ({ height: `${105 + aimState.power * 190}px`, transform: `translateX(-50%) rotate(${aimState.aim * 34}deg)` } as CSSProperties) : undefined;
  const hoopStyle = { left: `${hoop.x * 100}%`, top: `${hoop.y * 100}%` } as CSSProperties;
  const ballStyle = { left: `${ball.x * 100}%`, top: `${ball.y * 100}%`, transform: `translate(-50%,-50%) rotate(${ball.rotation}deg)`, opacity: ball.visible ? 1 : 0 } as CSSProperties;

  return <section className="dunkGameWrap">
    <div className="dunkHud">{soloActive ? <><div><small>SCORE</small><strong>{soloRun?.score ?? 0}</strong></div><div className="dunkHudCenter"><small>SÉRIE</small><strong>×{soloRun?.streak ?? 0}</strong></div><div className="dunkLives"><small>VIES</small><strong>{hearts(soloRun?.lives ?? 0)}</strong></div></> : <>{game.players[0] && <div className={`dunkPlayerHud ${game.status === "playing" && game.turnIndex === 0 ? "turn" : ""}`}><small>JOUEUR 1</small><strong>{game.players[0].username}</strong><span>{hearts(game.lives[game.players[0].userId] ?? game.livesTotal)}</span></div>}<div className="dunkHudCenter"><small>SÉRIE</small><strong>×{game.streak}</strong></div>{game.players[1] && <div className={`dunkPlayerHud ${game.status === "playing" && game.turnIndex === 1 ? "turn" : ""}`}><small>JOUEUR 2</small><strong>{game.players[1].username}</strong><span>{hearts(game.lives[game.players[1].userId] ?? game.livesTotal)}</span></div>}</>}</div>
    <div className="dunkInstruction"><span>{instruction}</span>{aimState && <strong>{Math.round(aimState.power * 100)}%</strong>}</div>
    <div ref={courtRef} className={`dunkCourt ${canShoot ? "canShoot" : ""}`} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={pointerUp}>
      <div className="dunkGymWall"><div className="dunkCeilingLights"><i/><i/><i/></div><div className="dunkWallStripe"/><div className="dunkArenaBoard"><small>DUNKSHOT ARENA</small><strong className="dunkArenaClock">{arenaClock}</strong><div className="dunkArenaScoreRow"><span><b>HOME</b><em>{String(homeValue).padStart(2, "0")}</em></span><i>{timerSeconds === null ? "NO TIMER" : "TIME"}</i><span><b>AWAY</b><em>{String(awayValue).padStart(2, "0")}</em></span></div></div><div className="dunkBleachers"><i/><i/><i/><i/><i/></div></div>
      <div className="dunkSkyGlow"/><div className="dunkFloor"><i/><i/><i/><i/></div>
      <div className={`dunkHoop ${hoop.moving ? "moving" : ""} ${ball.inside ? "swish" : ""}`} style={hoopStyle}><div className="dunkBackboard"/><div className="dunkRim"/><div className="dunkNet"><i/><i/><i/><i/></div></div>
      {aimState && !activeShot && <div className={`dunkAimArrow ${powerClass} ${aimState.power >= 0.97 ? "maxed" : ""}`} style={arrowStyle}><span/><b>▲</b></div>}
      <div className={`dunkBall ${ball.inside ? "insideHoop" : ""} ${ball.bounceCount > 0 ? "hasBounced" : ""}`} style={ballStyle}><span>🏀</span></div>
      {recentMessage && <div className={`dunkResultFlash ${recentMessage.made ? "made" : "miss"}`}>{recentMessage.text}</div>}
      {(soloGameover || duelGameover) && <div className="dunkGameOver"><span className="dunkTrophy">{soloGameover ? "🏀" : "🏆"}</span><small>{soloGameover ? "PARTIE TERMINÉE" : "DUEL TERMINÉ"}</small><h2>{soloGameover ? `${soloRun?.score ?? 0} panier${(soloRun?.score ?? 0) > 1 ? "s" : ""}` : winner ? `${winner.username} gagne !` : "Égalité !"}</h2>{soloGameover ? <div className="gameEndActions"><button className="primaryButton" onClick={startSolo}>Rejouer</button><button className="secondaryButton" onClick={exitSolo}>Lobby du jeu</button></div> : isHost ? <div className="gameEndActions"><button className="primaryButton" disabled={busy} onClick={() => game.players[1]?.isBot ? void startBot() : void startDuel(game.players.find((player) => player.userId !== user.id)?.userId ?? selectedOpponent)}>Rejouer</button><button className="secondaryButton" disabled={busy} onClick={() => void stopDuel()}>Lobby du jeu</button></div> : <small>En attente de l'hôte…</small>}</div>}
    </div>
    <p className="dunkHint">Le trajet est calculé une seule fois par tir puis rejoué à 60 images/s : le rendu et le score viennent exactement de la même simulation.</p>
    {error && <div className="errorBox dunkError">{error}</div>}
  </section>;
}
