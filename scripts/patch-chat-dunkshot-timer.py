from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected 1 match, found {count}")
    return text.replace(old, new, 1)


# Pong: don't steal W/S/arrows while typing, and only handle controls in an active match.
p = Path("app/PongGame.tsx")
text = p.read_text()
old = '''  useEffect(() => {
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
  }, []);'''
new = '''  useEffect(() => {
    const editable = (target: EventTarget | null) => {
      const element = target as HTMLElement | null;
      if (!element) return false;
      return element.tagName === "INPUT" ||
        element.tagName === "TEXTAREA" ||
        element.tagName === "SELECT" ||
        element.isContentEditable ||
        Boolean(element.closest?.("[contenteditable='true']"));
    };
    const down = (event: KeyboardEvent) => {
      if (game?.status !== "playing" || focusSuppressed || editable(event.target)) return;
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
    return () => {
      keysRef.current = { up: false, down: false };
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [game?.status, focusSuppressed]);'''
text = replace_once(text, old, new, "Pong keyboard guard")
p.write_text(text)


# Dunkshot frontend.
p = Path("app/DunkshotGame.tsx")
text = p.read_text()
text = replace_once(text, '''  winnerId: string | null;
};''', '''  winnerId: string | null;
  timeLimitSec: number;
  startedAt: number | null;
  endsAt: number | null;
};''', "frontend Game timer fields")
text = replace_once(text, 'type SoloRun = { active: boolean; lives: number; score: number; streak: number; gameover: boolean };', 'type SoloRun = { active: boolean; lives: number; score: number; streak: number; gameover: boolean; startedAt: number; endsAt: number | null };', "frontend SoloRun timer fields")
text = replace_once(text, 'const LIVES_OPTIONS = [1, 2, 3, 5, 7, 10];', 'const LIVES_OPTIONS = [1, 2, 3, 5, 7, 10];\nconst TIME_OPTIONS = [0, 30, 60, 90, 120, 180, 300];', "frontend timer options")
text = replace_once(text, 'const restBall = (): BallVisual => ({ x: BALL_START_X, y: BALL_START_Y, rotation: 0, visible: true, inside: false, bounceCount: 0 });', 'const restBall = (): BallVisual => ({ x: BALL_START_X, y: BALL_START_Y, rotation: 0, visible: true, inside: false, bounceCount: 0 });\nconst formatClock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.max(0, seconds % 60)).padStart(2, "0")}`;\nconst timeLabel = (seconds: number) => seconds === 0 ? "Désactivé" : seconds < 60 ? `${seconds}s` : `${seconds / 60} min`;', "frontend timer helpers")
text = replace_once(text, '''  const end = clamp(elapsed, 0, 2.7);

  while (t < end) {''', '''  const end = clamp(elapsed, 0, 2.7);
  const shotHoop = hoopPosition(streak, startedAt);

  while (t < end) {''', "frontend freeze hoop setup")
text = replace_once(text, '''    const hoop = hoopPosition(streak, startedAt + (t + dt) * 1000);
    const rimY = hoop.y + RIM_Y_OFFSET;''', '''    const hoop = shotHoop;
    const rimY = hoop.y + RIM_Y_OFFSET;''', "frontend freeze hoop simulation")
text = replace_once(text, '''    if (!made && floorBounces === 0) {
      for (const rimX of [hoop.x - RIM_HALF, hoop.x + RIM_HALF]) {''', '''    if (!made && floorBounces === 0 && vy > 0) {
      for (const rimX of [hoop.x - RIM_HALF, hoop.x + RIM_HALF]) {''', "frontend underside collision")
text = replace_once(text, '  const [soloLivesTotal, setSoloLivesTotal] = useState(3);', '  const [soloLivesTotal, setSoloLivesTotal] = useState(3);\n  const [soloTimeLimitSec, setSoloTimeLimitSec] = useState(0);', "frontend solo timer setting")
text = replace_once(text, '  const hoop = hoopPosition(activeStreak, sceneTime);', '  const hoop = activeShot ? hoopPosition(activeStreak, activeShot.startedAt) : hoopPosition(activeStreak, sceneTime);', "frontend displayed frozen hoop")
text = replace_once(text, '  useEffect(() => { soloRunRef.current = soloRun; }, [soloRun]);', '''  useEffect(() => { soloRunRef.current = soloRun; }, [soloRun]);

  useEffect(() => {
    const current = soloRunRef.current;
    if (!current?.active || current.gameover || !current.endsAt || sceneTime < current.endsAt || soloShot) return;
    const next = { ...current, gameover: true };
    soloRunRef.current = next;
    setSoloRun(next);
    setAimState(null);
    setSoloMessage({ text: "TEMPS ÉCOULÉ", made: false, at: Date.now() });
  }, [sceneTime, soloShot]);''', "frontend solo timer expiry")
text = replace_once(text, '''  const configureLives = async (livesTotal: number) => {
    try {
      setBusy(true); setError("");
      const data = await post({ action: "configure", code: room.code, livesTotal });
      setGame(data.game as Game);
    } catch (actionError) { setError(actionError instanceof Error ? actionError.message : "Erreur."); }
    finally { setBusy(false); }
  };''', '''  const configureSettings = async (livesTotal: number, timeLimitSec: number) => {
    try {
      setBusy(true); setError("");
      const data = await post({ action: "configure", code: room.code, livesTotal, timeLimitSec });
      setGame(data.game as Game);
    } catch (actionError) { setError(actionError instanceof Error ? actionError.message : "Erreur."); }
    finally { setBusy(false); }
  };''', "frontend configure timer")
text = replace_once(text, '''  const startSolo = () => {
    const next = { active: true, lives: soloLivesTotal, score: 0, streak: 0, gameover: false };''', '''  const startSolo = () => {
    const startedAt = Date.now();
    const next = { active: true, lives: soloLivesTotal, score: 0, streak: 0, gameover: false, startedAt, endsAt: soloTimeLimitSec > 0 ? startedAt + soloTimeLimitSec * 1000 : null };''', "frontend solo timer start")
text = replace_once(text, '''        <label><span>Vies</span><select value={soloLivesTotal} onChange={(event) => setSoloLivesTotal(Number(event.target.value))}>{LIVES_OPTIONS.map((value) => <option key={value} value={value}>{value} vie{value > 1 ? "s" : ""}</option>)}</select></label>
        <button className="primaryButton" onClick={startSolo}>Jouer en solo</button>''', '''        <label><span>Vies</span><select value={soloLivesTotal} onChange={(event) => setSoloLivesTotal(Number(event.target.value))}>{LIVES_OPTIONS.map((value) => <option key={value} value={value}>{value} vie{value > 1 ? "s" : ""}</option>)}</select></label>
        <label><span>Timer</span><select value={soloTimeLimitSec} onChange={(event) => setSoloTimeLimitSec(Number(event.target.value))}>{TIME_OPTIONS.map((value) => <option key={value} value={value}>{timeLabel(value)}</option>)}</select></label>
        <button className="primaryButton" onClick={startSolo}>Jouer en solo</button>''', "frontend solo timer UI")
text = replace_once(text, '''        <label><span>Vies</span><select value={game.livesTotal} disabled={!isHost || busy} onChange={(event) => void configureLives(Number(event.target.value))}>{LIVES_OPTIONS.map((value) => <option key={value} value={value}>{value} vie{value > 1 ? "s" : ""}</option>)}</select></label>
        {isHost ? <>''', '''        <label><span>Vies</span><select value={game.livesTotal} disabled={!isHost || busy} onChange={(event) => void configureSettings(Number(event.target.value), game.timeLimitSec)}>{LIVES_OPTIONS.map((value) => <option key={value} value={value}>{value} vie{value > 1 ? "s" : ""}</option>)}</select></label>
        <label><span>Timer</span><select value={game.timeLimitSec} disabled={!isHost || busy} onChange={(event) => void configureSettings(game.livesTotal, Number(event.target.value))}>{TIME_OPTIONS.map((value) => <option key={value} value={value}>{timeLabel(value)}</option>)}</select></label>
        {isHost ? <>''', "frontend duel timer UI")
text = replace_once(text, '''  const recentMessage = soloMessage && sceneTime - soloMessage.at < 1800 ? soloMessage : null;
  const powerClass =''', '''  const recentMessage = soloMessage && sceneTime - soloMessage.at < 1800 ? soloMessage : null;
  const timerSeconds = soloActive
    ? (soloRun?.endsAt ? Math.max(0, Math.ceil((soloRun.endsAt - sceneTime) / 1000)) : null)
    : (game.timeLimitSec > 0 && game.endsAt ? Math.max(0, Math.ceil((game.endsAt - sceneTime) / 1000)) : null);
  const arenaClock = timerSeconds === null ? "--:--" : formatClock(timerSeconds);
  const homeValue = soloActive ? (soloRun?.score ?? 0) : (game.players[0] ? (game.lives[game.players[0].userId] ?? game.livesTotal) : 0);
  const awayValue = soloActive ? (soloRun?.lives ?? 0) : (game.players[1] ? (game.lives[game.players[1].userId] ?? game.livesTotal) : 0);
  const powerClass =''', "frontend timer display values")
text = replace_once(text, '        <div className="dunkArenaBoard"><small>DUNKSHOT ARENA</small><strong>24</strong><span>HOME&nbsp;&nbsp;00&nbsp;&nbsp;·&nbsp;&nbsp;00&nbsp;&nbsp;AWAY</span></div>', '''        <div className="dunkArenaBoard">
          <small>DUNKSHOT ARENA</small>
          <strong className="dunkArenaClock">{arenaClock}</strong>
          <div className="dunkArenaScoreRow">
            <span><b>HOME</b><em>{String(homeValue).padStart(2, "0")}</em></span>
            <i>{timerSeconds === null ? "NO TIMER" : "TIME"}</i>
            <span><b>AWAY</b><em>{String(awayValue).padStart(2, "0")}</em></span>
          </div>
        </div>''', "frontend scoreboard markup")
text = replace_once(text, '        <h2>{soloGameover ? `${soloRun?.score ?? 0} panier${(soloRun?.score ?? 0) > 1 ? "s" : ""}` : `${winner?.username ?? "Joueur"} gagne !`}</h2>', '        <h2>{soloGameover ? `${soloRun?.score ?? 0} panier${(soloRun?.score ?? 0) > 1 ? "s" : ""}` : winner ? `${winner.username} gagne !` : "Égalité !"}</h2>', "frontend timer draw message")
p.write_text(text)


# Dunkshot backend: timer and the same frozen-hoop physics as the client.
p = Path("app/api/dunkshot/route.ts")
text = p.read_text()
text = replace_once(text, '''  winner_id: string | null;
};''', '''  winner_id: string | null;
  time_limit_sec: number;
  started_at: number | null;
  ends_at: number | null;
};''', "backend Row timer fields")
text = replace_once(text, '''        winner_id text,
        updated_at timestamptz not null default now()''', '''        winner_id text,
        time_limit_sec integer not null default 0,
        started_at bigint,
        ends_at bigint,
        updated_at timestamptz not null default now()''', "backend create timer columns")
text = replace_once(text, '      alter table retro_dunkshot_games add column if not exists winner_id text;', '      alter table retro_dunkshot_games add column if not exists winner_id text;\n      alter table retro_dunkshot_games add column if not exists time_limit_sec integer not null default 0;\n      alter table retro_dunkshot_games add column if not exists started_at bigint;\n      alter table retro_dunkshot_games add column if not exists ends_at bigint;', "backend alter timer columns")
text = replace_once(text, '''  let floorBounces = 0;
  let made = false;

  for (let elapsed = 0; elapsed <= 2.65; elapsed += DUNK_STEP) {''', '''  let floorBounces = 0;
  let made = false;
  const shotHoop = dunkHoopPosition(streak, shot.startedAt);

  for (let elapsed = 0; elapsed <= 2.65; elapsed += DUNK_STEP) {''', "backend freeze hoop setup")
text = replace_once(text, '''    const hoop = dunkHoopPosition(streak, shot.startedAt + (elapsed + DUNK_STEP) * 1000);
    const rimY = hoop.y + DUNK_RIM_Y_OFFSET;''', '''    const hoop = shotHoop;
    const rimY = hoop.y + DUNK_RIM_Y_OFFSET;''', "backend freeze hoop simulation")
text = replace_once(text, '''    if (floorBounces === 0) {
      for (const rimX of [hoop.x - DUNK_RIM_HALF, hoop.x + DUNK_RIM_HALF]) {''', '''    if (floorBounces === 0 && vy > 0) {
      for (const rimX of [hoop.x - DUNK_RIM_HALF, hoop.x + DUNK_RIM_HALF]) {''', "backend underside collision")
text = replace_once(text, '''    winnerId: row.winner_id,
  };''', '''    winnerId: row.winner_id,
    timeLimitSec: Math.max(0, Math.min(600, Number(row.time_limit_sec) || 0)),
    startedAt: row.started_at ? Number(row.started_at) : null,
    endsAt: row.ends_at ? Number(row.ends_at) : null,
  };''', "backend output timer fields")
text = text.replace('room_code,status,players,lives_total,lives,turn_index,streak,shot,last_result,winner_id', 'room_code,status,players,lives_total,lives,turn_index,streak,shot,last_result,winner_id,time_limit_sec,started_at,ends_at')
text = replace_once(text, '''async function state(code: string) {
  const current = await row(code);''', '''async function expireTimedGame(current: Row) {
  const endsAt = Number(current.ends_at) || 0;
  if (current.status !== "playing" || !endsAt || Date.now() < endsAt || parseShot(current.shot)) return current;
  const players = parsePlayers(current.players);
  const lives = parseLives(current.lives);
  let winnerId: string | null = null;
  if (players.length >= 2) {
    const first = lives[players[0].userId] ?? current.lives_total;
    const second = lives[players[1].userId] ?? current.lives_total;
    if (first > second) winnerId = players[0].userId;
    else if (second > first) winnerId = players[1].userId;
  }
  await db().query(`update retro_dunkshot_games set status='gameover',winner_id=$1,shot=null,updated_at=now() where room_code=$2`, [winnerId, current.room_code]);
  return await row(current.room_code);
}

async function state(code: string) {
  let current = await expireTimedGame(await row(code));''', "backend timed state expiry")
text = replace_once(text, '''      await db().query(`update retro_dunkshot_games set status='lobby',players='[]'::jsonb,lives='{}'::jsonb,turn_index=0,streak=0,shot=null,last_result=null,winner_id=null,updated_at=now() where room_code=$1`, [code]);''', '''      await db().query(`update retro_dunkshot_games set status='lobby',players='[]'::jsonb,lives='{}'::jsonb,turn_index=0,streak=0,shot=null,last_result=null,winner_id=null,started_at=null,ends_at=null,updated_at=now() where room_code=$1`, [code]);''', "backend other-game reset timer")
text = replace_once(text, '''      const livesTotal = Math.max(1, Math.min(10, Math.round(Number(data.livesTotal) || 1)));
      await db().query(`update retro_dunkshot_games set lives_total=$1,status='lobby',players='[]'::jsonb,lives='{}'::jsonb,turn_index=0,streak=0,shot=null,last_result=null,winner_id=null,updated_at=now() where room_code=$2`, [livesTotal, code]);''', '''      const livesTotal = Math.max(1, Math.min(10, Math.round(Number(data.livesTotal) || 1)));
      const timeLimitSec = Math.max(0, Math.min(600, Math.round(Number(data.timeLimitSec) || 0)));
      await db().query(`update retro_dunkshot_games set lives_total=$1,time_limit_sec=$2,status='lobby',players='[]'::jsonb,lives='{}'::jsonb,turn_index=0,streak=0,shot=null,last_result=null,winner_id=null,started_at=null,ends_at=null,updated_at=now() where room_code=$3`, [livesTotal, timeLimitSec, code]);''', "backend configure timer")
text = replace_once(text, '''      const lives = Object.fromEntries(players.map((player) => [player.userId, Math.max(1, Math.min(10, Number(settings.lives_total) || 1))]));
      await resetOtherGames(code);
      await db().query(
        `update retro_dunkshot_games set status='playing',players=$1::jsonb,lives=$2::jsonb,turn_index=0,streak=0,shot=null,last_result=null,winner_id=null,updated_at=now() where room_code=$3`,
        [JSON.stringify(players), JSON.stringify(lives), code]
      );''', '''      const lives = Object.fromEntries(players.map((player) => [player.userId, Math.max(1, Math.min(10, Number(settings.lives_total) || 1))]));
      const timeLimitSec = Math.max(0, Math.min(600, Number(settings.time_limit_sec) || 0));
      const startedAt = Date.now();
      const endsAt = timeLimitSec > 0 ? startedAt + timeLimitSec * 1000 : null;
      await resetOtherGames(code);
      await db().query(
        `update retro_dunkshot_games set status='playing',players=$1::jsonb,lives=$2::jsonb,turn_index=0,streak=0,shot=null,last_result=null,winner_id=null,started_at=$3,ends_at=$4,updated_at=now() where room_code=$5`,
        [JSON.stringify(players), JSON.stringify(lives), startedAt, endsAt, code]
      );''', "backend start timer")
text = replace_once(text, '''        if (!current || current.status !== "playing") throw new Error("La partie Dunkshot n'est pas en cours.");
        const players = parsePlayers(current.players);''', '''        if (!current || current.status !== "playing") throw new Error("La partie Dunkshot n'est pas en cours.");
        if (current.ends_at && Number(current.ends_at) <= Date.now()) throw new Error("Temps écoulé.");
        const players = parsePlayers(current.players);''', "backend block late shot")
text = text.replace("set status='lobby',players='[]'::jsonb,lives='{}'::jsonb,turn_index=0,streak=0,shot=null,last_result=null,winner_id=null,updated_at=now() where room_code=$1", "set status='lobby',players='[]'::jsonb,lives='{}'::jsonb,turn_index=0,streak=0,shot=null,last_result=null,winner_id=null,started_at=null,ends_at=null,updated_at=now() where room_code=$1")
p.write_text(text)


# Court and scoreboard layout polish.
p = Path("app/dunkshot.css")
text = p.read_text()
marker = "/* Dunkshot timer + court layout v2 */"
if marker in text:
    raise RuntimeError("CSS v2 already present")
text += r'''

/* Dunkshot timer + court layout v2 */
.dunkSetupPanel{grid-template-columns:minmax(0,1fr) repeat(4,minmax(104px,auto))}
.dunkCourt{isolation:isolate;background:#111927}
.dunkGymWall{inset:0 0 38% 0;background:linear-gradient(180deg,rgba(9,14,22,.2),rgba(12,20,31,.05) 65%,rgba(0,0,0,.28)),repeating-linear-gradient(90deg,#172333 0 12.4%,#1a2738 12.4% 24.8%);border-bottom:4px solid rgba(239,236,222,.28)}
.dunkGymWall:before{background:linear-gradient(180deg,rgba(255,255,255,.035),transparent 14%),repeating-linear-gradient(0deg,transparent 0 58px,rgba(255,255,255,.025) 59px 60px)}
.dunkCeilingLights{top:5%;z-index:2}.dunkWallStripe{bottom:9%;z-index:2;height:9px}.dunkBleachers{height:30%;opacity:.56;bottom:0}
.dunkArenaBoard{z-index:6;right:5%;top:13%;width:190px;padding:9px 12px 10px;border:4px solid #3a4654;background:linear-gradient(180deg,#05070a,#090d12);box-shadow:0 12px 30px rgba(0,0,0,.48),inset 0 0 22px rgba(255,105,40,.05)}
.dunkArenaBoard small{font-size:6px;color:#83909c}.dunkArenaBoard .dunkArenaClock{display:block;margin:5px 0 7px;color:#ff7840;font:950 31px/1 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.03em;text-shadow:0 0 13px rgba(255,91,31,.42)}
.dunkArenaScoreRow{display:grid;grid-template-columns:1fr auto 1fr;align-items:end;gap:7px;border-top:1px solid #27303a;padding-top:6px}.dunkArenaScoreRow>span{display:grid;gap:2px;color:#e6edf2!important;font:900 8px/1 ui-monospace,SFMono-Regular,Menlo,monospace!important;letter-spacing:.08em!important}.dunkArenaScoreRow>span:first-child{text-align:left}.dunkArenaScoreRow>span:last-child{text-align:right}.dunkArenaScoreRow b{font-size:6px;color:#8d9aa6}.dunkArenaScoreRow em{font-style:normal;font-size:16px;color:#f2f5f7}.dunkArenaScoreRow>i{font-style:normal;font:800 5px/1 ui-monospace,SFMono-Regular,Menlo,monospace;color:#687580;letter-spacing:.08em;padding-bottom:2px}
.dunkFloor{z-index:2;left:-2%;right:-2%;bottom:-3%;height:44%;transform:none;clip-path:polygon(10% 0,90% 0,100% 100%,0 100%);border-top:4px solid rgba(255,242,222,.62);background:linear-gradient(90deg,transparent 49.7%,rgba(255,247,230,.52) 49.8% 50.2%,transparent 50.3%),repeating-linear-gradient(90deg,rgba(255,255,255,.035) 0 1px,transparent 1px 68px),repeating-linear-gradient(0deg,rgba(88,42,18,.14) 0 2px,transparent 2px 18px),linear-gradient(180deg,#d38a4d 0%,#b96534 56%,#874324 100%);box-shadow:inset 0 18px 30px rgba(255,218,166,.08)}
.dunkFloor:before{left:50%;top:48%;width:24%;height:44%;border:3px solid rgba(255,247,231,.58);border-radius:50%;transform:translate(-50%,-50%);background:transparent}.dunkFloor:after{left:50%;top:-2%;width:25%;height:62%;border:3px solid rgba(255,247,231,.58);border-top:0;border-radius:0 0 46% 46%;transform:translateX(-50%);background:rgba(255,255,255,.018)}
.dunkFloor i{top:0;bottom:0;background:rgba(255,247,231,.22)}.dunkFloor i:nth-child(1){left:21%}.dunkFloor i:nth-child(2){left:36%}.dunkFloor i:nth-child(3){left:64%}.dunkFloor i:nth-child(4){left:79%}
.dunkHoop{z-index:9}.dunkBackboard{z-index:3}.dunkNet{z-index:6}.dunkRim{z-index:8}.dunkBall{z-index:11}.dunkBall.insideHoop{z-index:7}
@media(max-width:850px){.dunkSetupPanel{grid-template-columns:1fr 1fr}.dunkArenaBoard{width:164px;right:4.5%;top:12%}.dunkArenaBoard .dunkArenaClock{font-size:27px}.dunkFloor{height:41%;bottom:-1%}}
@media(max-width:600px){.dunkArenaBoard{width:142px;right:3%;top:10%;padding:6px 8px 7px;border-width:3px}.dunkArenaBoard .dunkArenaClock{font-size:22px;margin:4px 0 5px}.dunkArenaScoreRow{gap:4px;padding-top:4px}.dunkArenaScoreRow em{font-size:13px}.dunkGymWall{inset:0 0 42% 0}.dunkFloor{left:-8%;right:-8%;height:43%;bottom:-1%;clip-path:polygon(3% 0,97% 0,100% 100%,0 100%)}}
'''
p.write_text(text)
