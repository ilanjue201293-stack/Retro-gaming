from pathlib import Path
import re


def replace_one(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected 1 occurrence, got {count}")
    return text.replace(old, new, 1)

# ---------- RetroApp: only keep the active game mounted ----------
p = Path("app/RetroApp.tsx")
s = p.read_text()
s = replace_one(s,
'''  const [hockeyActive, setHockeyActive] = useState(false);''',
'''  const [hockeyActive, setHockeyActive] = useState(false);\n  const [activeGame, setActiveGame] = useState<"hockey" | "pool" | null>(null);''',
"RetroApp activeGame state")

anchor = '''  useEffect(() => {\n    if (!toast) return;\n    const id = window.setTimeout(() => setToast(""), 2800);\n    return () => window.clearTimeout(id);\n  }, [toast]);'''
insert = anchor + '''\n\n  useEffect(() => {\n    const onGameActive = (event: Event) => {\n      const detail = (event as CustomEvent<string | null>).detail;\n      setActiveGame(detail === "hockey" || detail === "pool" ? detail : null);\n    };\n    window.addEventListener("retro:game-active", onGameActive as EventListener);\n    return () => window.removeEventListener("retro:game-active", onGameActive as EventListener);\n  }, []);'''
s = replace_one(s, anchor, insert, "RetroApp active event")
s = replace_one(s,
'''    const id = window.setInterval(() => void refreshSocial(), 3000);\n    return () => window.clearInterval(id);\n  }, [user, refreshSocial]);''',
'''    const id = window.setInterval(() => void refreshSocial(), activeGame ? 8000 : 3000);\n    return () => window.clearInterval(id);\n  }, [user, refreshSocial, activeGame]);''',
"RetroApp social throttle")
s = replace_one(s,
'''    const id = window.setInterval(poll, 1000);\n    return () => { alive = false; window.clearInterval(id); };\n  }, [room?.code]);''',
'''    const id = window.setInterval(poll, activeGame ? 2200 : 1000);\n    return () => { alive = false; window.clearInterval(id); };\n  }, [room?.code, activeGame]);''',
"RetroApp room throttle")
old_games = '''            <HockeyGame room={room} user={user} onActiveChange={setHockeyActive}/>\n            <PongGame room={room} user={user}/>\n            <RpsGame room={room} user={user}/>\n            <DunkshotGame room={room} user={user}/>\n            <PoolGame room={room} user={user}/>'''
new_games = '''            {(!activeGame || activeGame === "hockey") && <HockeyGame room={room} user={user} onActiveChange={setHockeyActive}/>}\n            {!activeGame && <PongGame room={room} user={user}/>}\n            {!activeGame && <RpsGame room={room} user={user}/>}\n            {!activeGame && <DunkshotGame room={room} user={user}/>}\n            {(!activeGame || activeGame === "pool") && <PoolGame room={room} user={user}/>}'''
s = replace_one(s, old_games, new_games, "RetroApp conditional games")
s = replace_one(s,
'''      <RoomComms code={room.code} user={user}/>''',
'''      <RoomComms code={room.code} user={user} gameActive={Boolean(activeGame)}/>''',
"RetroApp comms prop")
p.write_text(s)

# ---------- RoomComms: back off non-game-critical polling during a match ----------
p = Path("app/RoomComms.tsx")
s = p.read_text()
s = replace_one(s,
'''export default function RoomComms({code,user}:{code:string;user:User}){''',
'''export default function RoomComms({code,user,gameActive=false}:{code:string;user:User;gameActive?:boolean}){''',
"RoomComms prop")
s = replace_one(s,
'''    void poll();const id=setInterval(poll,1000);return()=>{alive=false;clearInterval(id)};\n  },[code,user.id]);''',
'''    void poll();const id=setInterval(poll,gameActive?2500:1000);return()=>{alive=false;clearInterval(id)};\n  },[code,user.id,gameActive]);''',
"RoomComms chat throttle")
s = replace_one(s,
'''    void poll();const id=setInterval(poll,2000);return()=>{alive=false;clearInterval(id)};\n  },[voiceJoined,code]);''',
'''    void poll();const id=setInterval(poll,gameActive?5000:2000);return()=>{alive=false;clearInterval(id)};\n  },[voiceJoined,code,gameActive]);''',
"RoomComms voice-state throttle")
p.write_text(s)

# ---------- Hockey: TURN + reconnect timeout + less backend pressure ----------
p = Path("app/HockeyGame.tsx")
s = p.read_text()
s = replace_one(s,
'''const ICE_SERVERS: RTCIceServer[] = [\n  { urls: "stun:stun.l.google.com:19302" },\n  { urls: "stun:stun1.l.google.com:19302" },\n];''',
'''const ICE_SERVERS: RTCIceServer[] = [\n  { urls: "stun:stun.l.google.com:19302" },\n  { urls: "stun:stun1.l.google.com:19302" },\n  { urls: "stun:stun.relay.metered.ca:80" },\n  { urls: "turn:global.relay.metered.ca:80", username: "openrelayproject", credential: "openrelayproject" },\n  { urls: "turn:global.relay.metered.ca:80?transport=tcp", username: "openrelayproject", credential: "openrelayproject" },\n  { urls: "turns:global.relay.metered.ca:443?transport=tcp", username: "openrelayproject", credential: "openrelayproject" },\n];''',
"Hockey ICE servers")
s = replace_one(s,
'''  const timeout = window.setTimeout(() => controller.abort(), 3500);''',
'''  const timeout = window.setTimeout(() => controller.abort(), 8000);''',
"Hockey timeout")
s = replace_one(s,
'''  const lastDirectStateAtRef = useRef(0);''',
'''  const lastDirectStateAtRef = useRef(0);\n  const peerStartedAtRef = useRef<Map<string, number>>(new Map());''',
"Hockey peer timestamp ref")

anchor = '''  useEffect(() => {\n    if (game?.status === "lobby") setFocusSuppressed(false);\n  }, [game?.status]);'''
insert = anchor + '''\n  useEffect(() => {\n    if (!game) return;\n    const active = game.status === "playing" || game.status === "gameover";\n    window.dispatchEvent(new CustomEvent("retro:game-active", { detail: active ? "hockey" : null }));\n  }, [game?.status]);'''
s = replace_one(s, anchor, insert, "Hockey active event")
s = replace_one(s,
'''    directAckRef.current.delete(peerId);\n    reconnectingRef.current.delete(peerId);''',
'''    directAckRef.current.delete(peerId);\n    peerStartedAtRef.current.delete(peerId);\n    reconnectingRef.current.delete(peerId);''',
"Hockey close peer timestamp")
s = replace_one(s,
'''  const closeAllPeers = useCallback(() => { for (const peerId of [...peersRef.current.keys()]) closePeer(peerId); pendingIceRef.current.clear(); directAckRef.current.clear(); lastDirectStateAtRef.current = 0; reconnectingRef.current.clear(); }, [closePeer]);''',
'''  const closeAllPeers = useCallback(() => { for (const peerId of [...peersRef.current.keys()]) closePeer(peerId); pendingIceRef.current.clear(); directAckRef.current.clear(); peerStartedAtRef.current.clear(); lastDirectStateAtRef.current = 0; reconnectingRef.current.clear(); }, [closePeer]);''',
"Hockey close all timestamp")
s = replace_one(s,
'''    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS }); const entry: PeerEntry = { pc, dc: null }; peersRef.current.set(peerId, entry);''',
'''    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS, iceCandidatePoolSize: 4 }); const entry: PeerEntry = { pc, dc: null }; peersRef.current.set(peerId, entry); peerStartedAtRef.current.set(peerId, performance.now());''',
"Hockey peer config")
s = replace_one(s,
'''    const existing = peersRef.current.get(peerId); const ackAge = performance.now() - (directAckRef.current.get(peerId) ?? 0); if (existing?.dc?.readyState === "open" && ackAge < 1600) return; if (existing?.pc.connectionState === "connecting") return;''',
'''    const existing = peersRef.current.get(peerId); const now = performance.now(); const ackAge = now - (directAckRef.current.get(peerId) ?? 0); const connectingAge = now - (peerStartedAtRef.current.get(peerId) ?? 0); if (existing?.dc?.readyState === "open" && ackAge < 1800) return; if (existing?.pc.connectionState === "connecting" && connectingAge < 3500) return;''',
"Hockey connecting watchdog")
s = replace_one(s,
'''const channel = entry.pc.createDataChannel("retro-hockey", { ordered: false, maxRetransmits: 0 });''',
'''const channel = entry.pc.createDataChannel("retro-hockey", { ordered: false, maxPacketLifeTime: 180 });''',
"Hockey datachannel policy")
s = s.replace('current?.status === "playing" ? 2600 : 1100', 'current?.status === "playing" ? 6000 : 1800')
s = s.replace('current?.status === "playing" ? 3200 : 1600', 'current?.status === "playing" ? 7000 : 2200')
p.write_text(s)

# ---------- Rooms: starting Hockey also clears an old Pool match ----------
p = Path("app/api/rooms/route.ts")
s = p.read_text()
needle = '''        await db().query(`update retro_rps_games set status='lobby',players='[]'::jsonb,round_index=0,left_score=0,right_score=0,choices='{}'::jsonb,phase='choosing',phase_started_at=null,phase_ends_at=null,last_result=null,winner_side=null,updated_at=now() where room_code=$1`, [code]).catch(() => undefined);'''
addition = needle + '''\n        await db().query(`update retro_pool_games set status='lobby',players='[]'::jsonb,turn_index=0,groups='{}'::jsonb,shot=null,winner_id=null,last_message=null,updated_at=now() where room_code=$1`, [code]).catch(() => undefined);'''
s = replace_one(s, needle, addition, "Hockey clears Pool")
p.write_text(s)

# ---------- Pool client ----------
p = Path("app/PoolGame.tsx")
s = p.read_text()
s = replace_one(s,
'''type Player = { userId: string; username: string };''',
'''type BotDifficulty = "easy" | "normal" | "hard";\ntype Player = { userId: string; username: string; isBot?: boolean; difficulty?: BotDifficulty };''',
"Pool client player type")
s = replace_one(s,
'''  const [selectedOpponent, setSelectedOpponent] = useState("");\n  const [busy, setBusy] = useState(false);''',
'''  const [selectedOpponent, setSelectedOpponent] = useState("");\n  const [botDifficulty, setBotDifficulty] = useState<BotDifficulty>("normal");\n  const [busy, setBusy] = useState(false);''',
"Pool bot difficulty state")
s = replace_one(s,
'''  const resolvedRef = useRef<Set<string>>(new Set());''',
'''  const resolvedRef = useRef<Set<string>>(new Set());\n  const botActionRef = useRef(false);''',
"Pool bot action ref")
s = replace_one(s,
'''      if (alive) timer = window.setTimeout(() => void poll(), duelActive ? 350 : 1400);''',
'''      if (alive) timer = window.setTimeout(() => void poll(), duelActive ? 160 : 2200);''',
"Pool poll rate")
anchor = '''  useEffect(() => {\n    document.body.classList.toggle("pool-match-active", active && !focusSuppressed);\n    return () => document.body.classList.remove("pool-match-active");\n  }, [active, focusSuppressed]);'''
insert = anchor + '''\n\n  useEffect(() => {\n    window.dispatchEvent(new CustomEvent("retro:game-active", { detail: active ? "pool" : null }));\n  }, [active]);'''
s = replace_one(s, anchor, insert, "Pool active event")
s = replace_one(s,
'''      if (activeShot.shooterId === user.id && !resolvedRef.current.has(activeShot.id)) {\n        resolvedRef.current.add(activeShot.id);\n        void post({ action: "resolve", code: room.code, shotId: activeShot.id }).then((data) => setGame(data.game as Game)).catch((resolveError) => setError(resolveError instanceof Error ? resolveError.message : "Impossible de valider le coup."));\n      }''',
'''      const shotPlayer = game?.players.find((player) => player.userId === activeShot.shooterId);\n      const canResolve = activeShot.shooterId === user.id || Boolean(isHost && shotPlayer?.isBot);\n      if (canResolve && !resolvedRef.current.has(activeShot.id)) {\n        resolvedRef.current.add(activeShot.id);\n        void post({ action: "resolve", code: room.code, shotId: activeShot.id }).then((data) => setGame(data.game as Game)).catch((resolveError) => setError(resolveError instanceof Error ? resolveError.message : "Impossible de valider le coup."));\n      }''',
"Pool bot resolve client")
s = replace_one(s,
'''  const startDuel = async (opponentId = selectedOpponent) => {\n    try { setBusy(true); setError(""); setFocusSuppressed(false); setAim(null); const data = await post({ action: "start", code: room.code, opponentId }); setGame(data.game as Game); setVisualBalls(cloneBalls(data.game.balls as Ball[])); }''',
'''  const startDuel = async (opponentId = selectedOpponent, botDifficultyValue: BotDifficulty | null = null) => {\n    try { setBusy(true); setError(""); setFocusSuppressed(false); setAim(null); const data = await post({ action: "start", code: room.code, opponentId, botDifficulty: botDifficultyValue }); setGame(data.game as Game); setVisualBalls(cloneBalls(data.game.balls as Ball[])); }''',
"Pool start duel bot arg")

# Insert bot turn automation just before startSolo
marker = '''  const startSolo = () => {'''
bot_effect = '''  useEffect(() => {\n    if (!duelActive || game?.status !== "playing" || !isHost || game.shot || !currentPlayer?.isBot) { botActionRef.current = false; return; }\n    if (botActionRef.current) return;\n    botActionRef.current = true;\n    const delay = currentPlayer.difficulty === "easy" ? 850 : currentPlayer.difficulty === "hard" ? 360 : 560;\n    const id = window.setTimeout(() => {\n      void post({ action: "botShoot", code: room.code }).then((data) => setGame(data.game as Game)).catch((botError) => setError(botError instanceof Error ? botError.message : "Le bot n'a pas pu jouer.")).finally(() => { botActionRef.current = false; });\n    }, delay);\n    return () => window.clearTimeout(id);\n  }, [duelActive, game?.status, game?.turnIndex, game?.shot?.id, currentPlayer?.userId, isHost, room.code]);\n\n'''
s = replace_one(s, marker, bot_effect + marker, "Pool bot turn effect")
s = replace_one(s,
'''    if (soloActive) { setSoloShot({ id: `solo-pool-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, shooterId: user.id, angle, power, startedAt: Date.now() + 60 }); return; }\n    try { const data = await post({ action: "shoot", code: room.code, angle, power }); setGame(data.game as Game); }\n    catch (actionError) { setError(actionError instanceof Error ? actionError.message : "Coup impossible."); }''',
'''    if (soloActive) { setSoloShot({ id: `solo-pool-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, shooterId: user.id, angle, power, startedAt: Date.now() + 20 }); return; }\n    const shotId = `pool-${user.id}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;\n    const startedAt = Date.now() + 20;\n    const optimistic: Shot = { id: shotId, shooterId: user.id, angle, power, startedAt };\n    setGame((current) => current ? { ...current, shot: optimistic, lastMessage: null } : current);\n    try { const data = await post({ action: "shoot", code: room.code, angle, power, shotId, startedAt }); setGame(data.game as Game); }\n    catch (actionError) { setGame((current) => current?.shot?.id === shotId ? { ...current, shot: null } : current); setError(actionError instanceof Error ? actionError.message : "Coup impossible."); }''',
"Pool optimistic shot")

old_duel_ui = '''{isHost ? <><label><span>Adversaire</span><select value={selectedOpponent} disabled={!opponents.length || busy} onChange={(event) => setSelectedOpponent(event.target.value)}>{opponents.map((member) => <option key={member.id} value={member.id}>{member.username}</option>)}</select></label><button className="primaryButton" disabled={!selectedOpponent || busy} onClick={() => void startDuel()}>{busy ? "Lancement…" : "Lancer le 1v1"}</button></> : <small className="poolWaiting">En attente de l'hôte…</small>}</div>}'''
new_duel_ui = '''{isHost ? <><label><span>Adversaire</span><select value={selectedOpponent} disabled={!opponents.length || busy} onChange={(event) => setSelectedOpponent(event.target.value)}>{opponents.length ? opponents.map((member) => <option key={member.id} value={member.id}>{member.username}</option>) : <option value="">Aucun ami connecté</option>}</select></label><button className="primaryButton" disabled={!selectedOpponent || busy} onClick={() => void startDuel()}>{busy ? "Lancement…" : "Lancer le 1v1"}</button></> : <small className="poolWaiting">En attente de l'hôte…</small>}</div>}\n    {tab === "duel" && isHost && <div className="botPlayPanel poolBotPanel"><div><strong>🤖 Jouer contre un bot</strong><small>Le bot vise, dose sa puissance et joue automatiquement à son tour.</small></div><select value={botDifficulty} onChange={(event) => setBotDifficulty(event.target.value as BotDifficulty)}><option value="easy">Facile</option><option value="normal">Normal</option><option value="hard">Difficile</option></select><button disabled={busy} onClick={() => void startDuel("", botDifficulty)}>Lancer vs BOT</button></div>}'''
s = replace_one(s, old_duel_ui, new_duel_ui, "Pool bot lobby UI")

old_rail = '''      const filled = Boolean(id && pocketed.has(id));\n      return <span key={`${player?.userId ?? "empty"}-${index}`} className={`poolHudBall ${filled ? `filled ball-${id}` : ""}`}><i>{filled ? id : ""}</i></span>;'''
new_rail = '''      const assigned = Boolean(id);\n      const pocketedBall = Boolean(id && pocketed.has(id));\n      return <span key={`${player?.userId ?? "empty"}-${index}`} className={`poolHudBall ${assigned ? `assigned ball-${id}` : ""} ${pocketedBall ? "pocketed" : ""}`}><i>{assigned ? id : ""}</i></span>;'''
s = replace_one(s, old_rail, new_rail, "Pool colored HUD balls")

# Replay bot support: replace the host replay expression in game over
s = s.replace(
'''onClick={() => void startDuel(game.players.find((player) => player.userId !== user.id)?.userId ?? selectedOpponent)}''',
'''onClick={() => { const other = game.players.find((player) => player.userId !== user.id); void startDuel(other?.isBot ? "" : other?.userId ?? selectedOpponent, other?.isBot ? other.difficulty ?? botDifficulty : null); }}''')
p.write_text(s)

# ---------- Pool CSS: group colors visible immediately, pocketed ones highlighted ----------
p = Path("app/pool.css")
s = p.read_text()
old = '''.poolHudBall.filled{border-color:rgba(255,255,255,.24);box-shadow:inset -3px -4px 5px rgba(0,0,0,.26),inset 2px 2px 4px rgba(255,255,255,.2),0 2px 5px rgba(0,0,0,.3)}.poolHudBall i{width:45%;aspect-ratio:1;border-radius:50%;display:grid;place-items:center;background:transparent;color:transparent;font-size:6px;font-style:normal;font-weight:950;line-height:1}.poolHudBall.filled i{background:#f5f3eb;color:#141414}'''
new = '''.poolHudBall.assigned{opacity:.38;filter:saturate(.78);border-color:rgba(255,255,255,.2);box-shadow:inset -3px -4px 5px rgba(0,0,0,.25),inset 2px 2px 4px rgba(255,255,255,.16),0 2px 5px rgba(0,0,0,.25)}.poolHudBall.pocketed{opacity:1;filter:none;transform:scale(1.08);border-color:rgba(255,255,255,.42);box-shadow:inset -3px -4px 5px rgba(0,0,0,.26),inset 2px 2px 4px rgba(255,255,255,.26),0 0 9px rgba(255,255,255,.12)}.poolHudBall i{width:45%;aspect-ratio:1;border-radius:50%;display:grid;place-items:center;background:transparent;color:transparent;font-size:6px;font-style:normal;font-weight:950;line-height:1}.poolHudBall.assigned i{background:#f5f3eb;color:#141414}'''
s = replace_one(s, old, new, "Pool HUD color CSS")
p.write_text(s)

# ---------- Pool API: fast state, optimistic IDs/timestamps, bots ----------
p = Path("app/api/pool/route.ts")
s = p.read_text()
s = replace_one(s,
'''type Player = { userId: string; username: string };''',
'''type BotDifficulty = "easy" | "normal" | "hard";\ntype Player = { userId: string; username: string; isBot?: boolean; difficulty?: BotDifficulty };''',
"Pool API player type")

# Add bot aiming helper after ballGroup
marker = '''function ballGroup(id: number): Exclude<Group, null> | null {\n  if (id >= 1 && id <= 7) return "solids";\n  if (id >= 9 && id <= 15) return "stripes";\n  return null;\n}\n'''
helper = marker + '''\nfunction chooseBotShot(balls: Ball[], group: Group, difficulty: BotDifficulty) {\n  const cue = balls.find((ball) => ball.id === 0 && !ball.pocketed);\n  if (!cue) return { angle: 0, power: 0.55 };\n  let targets = balls.filter((ball) => !ball.pocketed && ball.id !== 0 && ball.id !== 8 && (!group || ballGroup(ball.id) === group));\n  if (!targets.length) targets = balls.filter((ball) => !ball.pocketed && ball.id === 8);\n  if (!targets.length) return { angle: 0, power: 0.55 };\n  const choices: { angle: number; power: number; score: number }[] = [];\n  for (const target of targets) {\n    for (const pocket of POCKETS) {\n      const tx = pocket.x - target.x, ty = pocket.y - target.y, targetDistance = Math.hypot(tx, ty);\n      if (targetDistance < 0.001) continue;\n      const ux = tx / targetDistance, uy = ty / targetDistance;\n      const ghostX = target.x - ux * BALL_R * 2.08, ghostY = target.y - uy * BALL_R * 2.08;\n      if (ghostX < LEFT || ghostX > RIGHT || ghostY < TOP || ghostY > BOTTOM) continue;\n      const cueDistance = Math.hypot(ghostX - cue.x, ghostY - cue.y);\n      const angle = Math.atan2(ghostY - cue.y, ghostX - cue.x);\n      const power = clamp(0.4 + cueDistance * 0.42 + targetDistance * 0.46, 0.42, 0.92);\n      choices.push({ angle, power, score: targetDistance + cueDistance * 0.42 });\n    }\n  }\n  choices.sort((a, b) => a.score - b.score);\n  const take = difficulty === "easy" ? Math.min(10, choices.length) : difficulty === "hard" ? Math.min(2, choices.length) : Math.min(5, choices.length);\n  const selected = choices[Math.floor(Math.random() * Math.max(1, take))] ?? { angle: Math.atan2(targets[0].y - cue.y, targets[0].x - cue.x), power: 0.62, score: 0 };\n  const error = difficulty === "easy" ? 0.11 : difficulty === "hard" ? 0.018 : 0.05;\n  const powerNoise = difficulty === "easy" ? 0.12 : difficulty === "hard" ? 0.025 : 0.06;\n  return { angle: selected.angle + (Math.random() * 2 - 1) * error, power: clamp(selected.power + (Math.random() * 2 - 1) * powerNoise, 0.32, 0.96) };\n}\n'''
s = replace_one(s, marker, helper, "Pool API bot aiming helper")

# Remove expensive cross-game queries on every Pool state poll
pattern = re.compile(r'''async function state\(code: string\) \{\n  const current = await row\(code\);\n  if \(current\.status !== "lobby"\) \{.*?\n  \}\n  return output\(current\);\n\}''', re.S)
match = pattern.search(s)
if not match:
    raise RuntimeError("Pool API state function not found")
s = s[:match.start()] + '''async function state(code: string) {\n  return output(await row(code));\n}''' + s[match.end():]

old_start = '''      const opponentId = String(data.opponentId ?? "");\n      const members = await db().query<{ id: string; username: string }>(`select u.id,u.username from retro_room_members m join retro_users u on u.id=m.user_id where m.room_code=$1 and m.last_seen>now()-interval '15 seconds' order by m.joined_at`, [code]);\n      const host = members.rows.find((member) => member.id === user.id);\n      const opponent = members.rows.find((member) => member.id === opponentId && member.id !== user.id) ?? members.rows.find((member) => member.id !== user.id);\n      if (!host || !opponent) throw new Error("Il faut 2 joueurs connectés pour jouer.");\n      const players: Player[] = [{ userId: host.id, username: host.username }, { userId: opponent.id, username: opponent.username }];'''
new_start = '''      const opponentId = String(data.opponentId ?? "");\n      const requestedBot = String(data.botDifficulty ?? "");\n      const botDifficulty: BotDifficulty | null = requestedBot === "easy" || requestedBot === "normal" || requestedBot === "hard" ? requestedBot : null;\n      const members = await db().query<{ id: string; username: string }>(`select u.id,u.username from retro_room_members m join retro_users u on u.id=m.user_id where m.room_code=$1 and m.last_seen>now()-interval '15 seconds' order by m.joined_at`, [code]);\n      const host = members.rows.find((member) => member.id === user.id);\n      const opponent = members.rows.find((member) => member.id === opponentId && member.id !== user.id) ?? members.rows.find((member) => member.id !== user.id);\n      if (!host || (!botDifficulty && !opponent)) throw new Error("Il faut 2 joueurs connectés ou choisir un bot.");\n      const players: Player[] = [{ userId: host.id, username: host.username }, botDifficulty ? { userId: "bot:pool", username: "BOT", isBot: true, difficulty: botDifficulty } : { userId: opponent!.id, username: opponent!.username }];'''
s = replace_one(s, old_start, new_start, "Pool API bot start")

s = replace_one(s,
'''        const shot: Shot = { id: makeId(), shooterId: user.id, angle, power, startedAt: Date.now() + 240 };''',
'''        const requestedShotId = String(data.shotId ?? "");\n        const shotId = /^[A-Za-z0-9:_-]{8,120}$/.test(requestedShotId) ? requestedShotId : makeId();\n        const now = Date.now();\n        const requestedStartedAt = Number(data.startedAt);\n        const startedAt = Number.isFinite(requestedStartedAt) && requestedStartedAt >= now - 1500 && requestedStartedAt <= now + 300 ? requestedStartedAt : now + 20;\n        const shot: Shot = { id: shotId, shooterId: user.id, angle, power, startedAt };''',
"Pool API immediate shot")

# Insert botShoot action before resolve
marker = '''    if (action === "resolve") {'''
bot_action = '''    if (action === "botShoot") {\n      if (await hostId(code) !== user.id) throw new Error("Seul l'hôte peut faire jouer le bot.");\n      const client = await db().connect();\n      try {\n        await client.query("begin");\n        const result = await client.query<Row>(`select room_code,status,players,turn_index,balls,groups,shot,winner_id,last_message from retro_pool_games where room_code=$1 for update`, [code]);\n        const current = result.rows[0]; if (!current || current.status !== "playing") throw new Error("La partie n'est pas en cours.");\n        if (parseShot(current.shot)) { await client.query("rollback"); return NextResponse.json({ ok: true, game: await state(code) }); }\n        const players = parsePlayers(current.players);\n        const bot = players[Math.max(0, current.turn_index) % Math.max(1, players.length)];\n        if (!bot?.isBot) throw new Error("Ce n'est pas au bot de jouer.");\n        const groups = parseGroups(current.groups);\n        const choice = chooseBotShot(parseBalls(current.balls), groups[bot.userId] ?? null, bot.difficulty ?? "normal");\n        const shot: Shot = { id: makeId(), shooterId: bot.userId, angle: choice.angle, power: choice.power, startedAt: Date.now() + 40 };\n        await client.query(`update retro_pool_games set shot=$1::jsonb,last_message=$2,updated_at=now() where room_code=$3`, [JSON.stringify(shot), `${bot.username} prépare son tir…`, code]);\n        await client.query("commit"); return NextResponse.json({ ok: true, game: await state(code) });\n      } catch (error) { try { await client.query("rollback"); } catch {} throw error; } finally { client.release(); }\n    }\n\n'''
s = replace_one(s, marker, bot_action + marker, "Pool API botShoot action")

old_auth = '''        if (shot.shooterId !== user.id) throw new Error("Seul le tireur peut valider le coup.");\n        const players = parsePlayers(current.players); const shooterIndex = Math.max(0, current.turn_index) % Math.max(1, players.length); const shooter = players[shooterIndex]; const opponent = players[(shooterIndex + 1) % players.length];\n        if (!shooter || !opponent) throw new Error("Joueurs invalides.");'''
new_auth = '''        const players = parsePlayers(current.players); const shooterIndex = Math.max(0, current.turn_index) % Math.max(1, players.length); const shooter = players[shooterIndex]; const opponent = players[(shooterIndex + 1) % players.length];\n        if (!shooter || !opponent || shooter.userId !== shot.shooterId) throw new Error("Joueurs invalides.");\n        const resolvingBotAsHost = Boolean(shooter.isBot && await hostId(code) === user.id);\n        if (shot.shooterId !== user.id && !resolvingBotAsHost) throw new Error("Seul le tireur peut valider le coup.");'''
s = replace_one(s, old_auth, new_auth, "Pool API bot resolve auth")
p.write_text(s)

print("Hockey + Pool v2 patch applied")
