from pathlib import Path
import re


def load(path: str) -> str:
    return Path(path).read_text()


def save(path: str, text: str) -> None:
    Path(path).write_text(text)


def rep(text: str, old: str, new: str, label: str, count: int | None = None) -> str:
    found = text.count(old)
    if found == 0:
        raise SystemExit(f"{label}: pattern not found")
    if count is not None and found != count:
        raise SystemExit(f"{label}: expected {count}, found {found}")
    return text.replace(old, new)


# ---------- HOCKEY SERVER ----------
path = "lib/hockey-room.ts"
t = load(path)
t = rep(
    t,
    'export type HockeyMode = "1v1" | "2v2";\ntype Side = "left" | "right";\ntype Player = { userId:string; username:string; avatarData?:string|null; side:Side; slot:number };',
    'export type HockeyMode = "1v1" | "2v2";\nexport type BotDifficulty = "easy" | "normal" | "hard";\ntype Side = "left" | "right";\ntype Player = { userId:string; username:string; avatarData?:string|null; side:Side; slot:number; isBot?:boolean; difficulty?:BotDifficulty };',
    "hockey types",
    1,
)
pattern = r'export async function hockeyStart\(code:string,userId:string\)\{.*?\n\}\nexport async function hockeyStop'
replacement = '''export async function hockeyStart(code:string,userId:string,botDifficulty:BotDifficulty|null=null){
  if(await host(code)!==userId)throw new Error("Seul l'hôte peut lancer le match.");
  const r=await row(code),need=r.mode==="2v2"?4:2,current=decode(r.players,r);
  const members=await db().query<{id:string;username:string;avatar_data:string|null}>(`select u.id,u.username,u.avatar_data from retro_room_members m join retro_users u on u.id=m.user_id where m.room_code=$1 and m.last_seen>now()-interval '15 seconds' order by m.joined_at`,[code]);
  let roster:Player[];
  if(botDifficulty&&r.mode==="1v1"){
    const human=members.rows.find((member)=>member.id===userId)??members.rows[0];
    if(!human)throw new Error("Tu dois être dans la room pour jouer contre un bot.");
    roster=[
      {userId:human.id,username:human.username,avatarData:human.avatar_data,side:"left",slot:0},
      {userId:"bot:hockey",username:"BOT",avatarData:null,side:"right",slot:0,isBot:true,difficulty:botDifficulty},
    ];
  }else{
    if(members.rows.length<need)throw new Error(r.mode==="2v2"?"Il faut 4 joueurs connectés pour le 2v2.":"Il faut 2 joueurs connectés pour le 1v1.");
    roster=members.rows.slice(0,need).map((m,i)=>({userId:m.id,username:m.username,avatarData:m.avatar_data,side:i%2===0?"left":"right",slot:r.mode==="2v2"?Math.floor(i/2):0}));
  }
  const now=Date.now(),frame=fresh(roster,r.mode,now),inputs=Object.fromEntries(roster.map(p=>[p.userId,{...initial(p,r.mode),at:now}])),s:Stored={roster,frame,inputs,lastTick:now,targetScore:current.targetScore,timeLimitSec:current.timeLimitSec,startedAt:now};
  await db().query(`update retro_hockey_games set status='playing',players=$1::jsonb,left_score=0,right_score=0,winner_side=null,updated_at=now() where room_code=$2`,[JSON.stringify(s),code]);
  return output({...r,status:"playing",players:s,left_score:0,right_score:0,winner_side:null},s);
}
export async function hockeyStop'''
t2, n = re.subn(pattern, replacement, t, flags=re.S)
if n != 1:
    raise SystemExit(f"hockeyStart replacement count={n}")
save(path, t2)

path = "app/api/rooms/route.ts"
t = load(path)
t = rep(
    t,
    'import { hockeyConfigure, hockeyStart, hockeyState, hockeyStop, type HockeyMode } from "@/lib/hockey-room";',
    'import { hockeyConfigure, hockeyStart, hockeyState, hockeyStop, type BotDifficulty, type HockeyMode } from "@/lib/hockey-room";',
    "rooms hockey import",
    1,
)
t = rep(
    t,
    '        return NextResponse.json({ ok: true, game: await hockeyStart(code, user.id) });',
    '        const requestedBot = String(data.botDifficulty ?? "");\n        const botDifficulty: BotDifficulty | null = requestedBot === "easy" || requestedBot === "normal" || requestedBot === "hard" ? requestedBot : null;\n        return NextResponse.json({ ok: true, game: await hockeyStart(code, user.id, botDifficulty) });',
    "hockeyStart route",
    1,
)
save(path, t)

# ---------- HOCKEY CLIENT ----------
path = "app/HockeyGame.tsx"
t = load(path)
t = rep(
    t,
    'type Mode = "1v1" | "2v2";\ntype Side = "left" | "right";\ntype Player = { userId: string; username: string; avatarData?: string | null; side: Side; slot: number };',
    'type Mode = "1v1" | "2v2";\ntype BotDifficulty = "easy" | "normal" | "hard";\ntype Side = "left" | "right";\ntype Player = { userId: string; username: string; avatarData?: string | null; side: Side; slot: number; isBot?: boolean; difficulty?: BotDifficulty };',
    "hockey client types",
    1,
)
insert = '''
function updateHockeyBot(simulation: Simulation, game: Game, now: number) {
  const bot = game.players.find((player) => player.isBot);
  if (!bot) return;
  const paddle = simulation.frame.paddles[bot.userId] ?? initialPaddle(bot, game.mode);
  if (Date.now() < simulation.frame.pauseUntil) { simulation.targets[bot.userId] = { ...paddle, vx: 0, vy: 0 }; return; }
  const difficulty = bot.difficulty ?? "normal";
  const speed = difficulty === "easy" ? 0.58 : difficulty === "hard" ? 1.18 : 0.86;
  const accuracy = difficulty === "easy" ? 0.075 : difficulty === "hard" ? 0.018 : 0.042;
  const puck = simulation.frame.puck;
  const attack = bot.side === "right" ? puck.x > 0.48 : puck.x < 0.52;
  const guardX = bot.side === "right" ? 0.82 : 0.18;
  const desiredX = attack ? clamp(puck.x + (bot.side === "right" ? 0.055 : -0.055), bot.side === "right" ? 0.56 : 0.10, bot.side === "right" ? 0.90 : 0.44) : guardX;
  const wobble = Math.sin(now / 420 + game.leftScore * 1.7 + game.rightScore) * accuracy;
  const desiredY = clamp(puck.y + wobble, 0.11, 0.89);
  const dt = clamp((now - simulation.lastTs) / 1000, 0.008, 0.032);
  const dx = desiredX - paddle.x, dy = desiredY - paddle.y, distance = Math.hypot(dx, dy);
  const maxMove = speed * dt;
  const factor = distance > maxMove && distance > 0.0001 ? maxMove / distance : 1;
  const point = clampPaddle(bot.side, paddle.x + dx * factor, paddle.y + dy * factor);
  simulation.targets[bot.userId] = { x: point.x, y: point.y, vx: (point.x - paddle.x) / dt, vy: (point.y - paddle.y) / dt };
}
'''
marker = "\nexport default function HockeyGame"
if marker not in t:
    raise SystemExit("hockey component marker missing")
t = t.replace(marker, insert + marker, 1)
t = rep(
    t,
    '  const [busy, setBusy] = useState(false);\n  const [frame, setFrame] = useState<Frame | null>(null);',
    '  const [busy, setBusy] = useState(false);\n  const [botDifficulty, setBotDifficulty] = useState<BotDifficulty>("normal");\n  const [frame, setFrame] = useState<Frame | null>(null);',
    "hockey bot state",
    1,
)
t = rep(t, 'const remotes = current.players.filter((player) => player.userId !== user.id);', 'const remotes = current.players.filter((player) => player.userId !== user.id && !player.isBot);', "hockey direct remotes", 1)
t = rep(t, 'for (const player of current.players) if (player.userId !== user.id) void startHostPeer(player.userId);', 'for (const player of current.players) if (player.userId !== user.id && !player.isBot) void startHostPeer(player.userId);', "hockey ensure peers", 1)
t = t.replace('if (player.userId === user.id) continue;', 'if (player.userId === user.id || player.isBot) continue;')
t = rep(
    t,
    '      if (Date.now() >= simulation.frame.pauseUntil) { const local = localInputRef.current; if (local) { const own = current.players.find((player) => player.userId === user.id); if (own) simulation.targets[user.id] = { ...local }; } }\n\n      let suddenDeath = false;',
    '      if (Date.now() >= simulation.frame.pauseUntil) { const local = localInputRef.current; if (local) { const own = current.players.find((player) => player.userId === user.id); if (own) simulation.targets[user.id] = { ...local }; } }\n      updateHockeyBot(simulation, current, now);\n\n      let suddenDeath = false;',
    "hockey bot tick",
    1,
)
t = rep(
    t,
    '      catch (pollError) { if (alive) { setError(pollError instanceof Error ? pollError.message : "Hockey indisponible."); timer = window.setTimeout(() => void poll(), 900); } }',
    '      catch (pollError) {\n        if (alive) {\n          const current = gameRef.current;\n          const message = pollError instanceof Error ? pollError.message : "Hockey indisponible.";\n          if (!current || current.status === "lobby") setError(message);\n          timer = window.setTimeout(() => void poll(), current?.status === "playing" ? 2200 : 900);\n        }\n      }',
    "hockey poll error",
    1,
)
t = t.replace("directReady ? 700 : 90", "directReady ? 1000 : 180")
t = t.replace("now - simulation.lastFallbackBroadcast >= 170", "now - simulation.lastFallbackBroadcast >= 280")
t = t.replace("now - lastFallbackInputSendRef.current >= 85", "now - lastFallbackInputSendRef.current >= 130")
t = rep(
    t,
    '  const start = async () => { try { setBusy(true); signalCursorRef.current = 0; closeAllPeers(); applyGame((await post({ action: "hockeyStart", code: room.code })).game as Game); setClock(Date.now()); } catch (actionError) { setError(actionError instanceof Error ? actionError.message : "Erreur."); } finally { setBusy(false); } };',
    '  const start = async (withBot = false) => { try { setBusy(true); signalCursorRef.current = 0; closeAllPeers(); applyGame((await post({ action: "hockeyStart", code: room.code, botDifficulty: withBot ? botDifficulty : null })).game as Game); setClock(Date.now()); } catch (actionError) { setError(actionError instanceof Error ? actionError.message : "Erreur."); } finally { setBusy(false); } };',
    "hockey start bot",
    1,
)
t = rep(
    t,
    '      <div className="hockeyReadyBar"><span>{online}/{needed} joueurs connectés</span>{isHost ? <button className="primaryButton" disabled={busy || online < needed} onClick={() => void start()}>{busy ? "Lancement…" : `Lancer le ${game.mode}`}</button> : <small>En attente de l\'hôte…</small>}</div>',
    '      <div className="hockeyReadyBar"><span>{online}/{needed} joueurs connectés</span>{isHost ? <button className="primaryButton" disabled={busy || online < needed} onClick={() => void start(false)}>{busy ? "Lancement…" : `Lancer le ${game.mode}`}</button> : <small>En attente de l\'hôte…</small>}</div>\n      {isHost && game.mode === "1v1" && online === 1 && <div className="botPlayPanel"><div><strong>🤖 Personne avec qui jouer ?</strong><small>Lance un 1v1 contre un bot.</small></div><select value={botDifficulty} onChange={(event) => setBotDifficulty(event.target.value as BotDifficulty)}><option value="easy">Facile</option><option value="normal">Normal</option><option value="hard">Difficile</option></select><button disabled={busy} onClick={() => void start(true)}>Jouer contre le bot</button></div>}',
    "hockey bot lobby",
    1,
)
save(path, t)

# ---------- PONG SERVER ----------
path = "app/api/pong/route.ts"
t = load(path)
t = rep(t, 'type Side = "left" | "right";\ntype Player = { userId: string; username: string; side: Side };', 'type Side = "left" | "right";\ntype BotDifficulty = "easy" | "normal" | "hard";\ntype Player = { userId: string; username: string; side: Side; isBot?: boolean; difficulty?: BotDifficulty };', "pong types", 1)
t = rep(
    t,
    '      if (members.rows.length !== 2) throw new Error("Pong se joue avec exactement 2 joueurs connectés.");\n      const players: Player[] = [\n        { userId: members.rows[0].id, username: members.rows[0].username, side: "left" },\n        { userId: members.rows[1].id, username: members.rows[1].username, side: "right" },\n      ];',
    '      const requestedBot = String(data.botDifficulty ?? "");\n      const botDifficulty: BotDifficulty | null = requestedBot === "easy" || requestedBot === "normal" || requestedBot === "hard" ? requestedBot : null;\n      let players: Player[];\n      if (botDifficulty) {\n        const human = members.rows.find((member) => member.id === user.id) ?? members.rows[0];\n        if (!human) throw new Error("Tu dois être dans la room pour jouer contre le bot.");\n        players = [\n          { userId: human.id, username: human.username, side: "left" },\n          { userId: "bot:pong", username: "BOT", side: "right", isBot: true, difficulty: botDifficulty },\n        ];\n      } else {\n        if (members.rows.length !== 2) throw new Error("Pong se joue avec exactement 2 joueurs connectés.");\n        players = [\n          { userId: members.rows[0].id, username: members.rows[0].username, side: "left" },\n          { userId: members.rows[1].id, username: members.rows[1].username, side: "right" },\n        ];\n      }',
    "pong bot start server",
    1,
)
save(path, t)

# ---------- PONG CLIENT ----------
path = "app/PongGame.tsx"
t = load(path)
t = rep(t, 'type Side = "left" | "right";\ntype Player = { userId: string; username: string; side: Side };', 'type Side = "left" | "right";\ntype BotDifficulty = "easy" | "normal" | "hard";\ntype Player = { userId: string; username: string; side: Side; isBot?: boolean; difficulty?: BotDifficulty };', "pong client types", 1)
helper = '''
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
'''
marker = "\nexport default function PongGame"
if marker not in t:
    raise SystemExit("pong marker missing")
t = t.replace(marker, helper + marker, 1)
t = rep(t, '  const [busy, setBusy] = useState(false);\n  const [clock, setClock] = useState(Date.now());', '  const [busy, setBusy] = useState(false);\n  const [botDifficulty, setBotDifficulty] = useState<BotDifficulty>("normal");\n  const [clock, setClock] = useState(Date.now());', "pong bot state", 1)
t = t.replace('gameRef.current?.players.find((p) => p.userId !== user.id)', 'gameRef.current?.players.find((p) => p.userId !== user.id && !p.isBot)')
t = t.replace('gameRef.current?.players.find((player) => player.userId !== user.id)', 'gameRef.current?.players.find((player) => player.userId !== user.id && !player.isBot)')
t = t.replace('if (player.userId === user.id) continue;', 'if (player.userId === user.id || player.isBot) continue;')
t = rep(t, '      const own = current.players.find((player) => player.userId === user.id);\n      if (own) simulation.targets[user.id] = localYRef.current;\n\n      let suddenDeath = false;', '      const own = current.players.find((player) => player.userId === user.id);\n      if (own) simulation.targets[user.id] = localYRef.current;\n      updatePongBot(simulation, current, now);\n\n      let suddenDeath = false;', "pong bot tick", 1)
t = rep(t, '  const start = async () => {\n    try {\n      setBusy(true); setError(""); closeAllPeers(); signalCursorRef.current = 0;\n      const data = await post({ action: "start", code: room.code });', '  const start = async (withBot = false) => {\n    try {\n      setBusy(true); setError(""); closeAllPeers(); signalCursorRef.current = 0;\n      const data = await post({ action: "start", code: room.code, botDifficulty: withBot ? botDifficulty : null });', "pong start client", 1)
t = t.replace('onClick={() => void start()}>{busy ? "Lancement…" : "Lancer Pong"}', 'onClick={() => void start(false)}>{busy ? "Lancement…" : "Lancer Pong"}')
t = rep(t, '      </div>\n      {error && <div className="errorBox">{error}</div>}\n    </section>;\n  }\n\n  const shown = frame', '      </div>\n      {isHost && online === 1 && <div className="botPlayPanel"><div><strong>🤖 Jouer contre un bot</strong><small>Pas besoin d\'attendre un ami.</small></div><select value={botDifficulty} onChange={(event) => setBotDifficulty(event.target.value as BotDifficulty)}><option value="easy">Facile</option><option value="normal">Normal</option><option value="hard">Difficile</option></select><button disabled={busy} onClick={() => void start(true)}>Lancer vs BOT</button></div>}\n      {error && <div className="errorBox">{error}</div>}\n    </section>;\n  }\n\n  const shown = frame', "pong bot lobby", 1)
t = t.replace('onClick={() => void start()}>Rejouer</button>', 'onClick={() => void start(Boolean(game.players.some((player) => player.isBot)))}>Rejouer</button>')
save(path, t)

# ---------- RPS SERVER ----------
path = "app/api/rps/route.ts"
t = load(path)
t = rep(t, 'type Side = "left" | "right";\ntype Choice = "rock" | "paper" | "scissors";\ntype Phase = "choosing" | "chant" | "reveal" | "gameover";\ntype Player = { userId: string; username: string; side: Side };', 'type Side = "left" | "right";\ntype Choice = "rock" | "paper" | "scissors";\ntype BotDifficulty = "easy" | "normal" | "hard";\ntype Phase = "choosing" | "chant" | "reveal" | "gameover";\ntype Player = { userId: string; username: string; side: Side; isBot?: boolean; difficulty?: BotDifficulty };', "rps types", 1)
helper = '''
function counterChoice(choice: Choice): Choice { return choice === "rock" ? "paper" : choice === "paper" ? "scissors" : "rock"; }
function botChoiceAgainst(choice: Choice, difficulty: BotDifficulty): Choice {
  const chance = difficulty === "easy" ? 0.18 : difficulty === "hard" ? 0.68 : 0.4;
  return Math.random() < chance ? counterChoice(choice) : randomChoice();
}
'''
t = t.replace('\nfunction roundWinner(left: Choice, right: Choice): Side | null {', helper + '\nfunction roundWinner(left: Choice, right: Choice): Side | null {', 1)
t = rep(t, '    const updated = await client.query<Row>(\n      `update retro_rps_games\n       set choices=coalesce(choices,\'{}\'::jsonb) || jsonb_build_object($2::text,$3::text),updated_at=now()\n       where room_code=$1\n       returning room_code,status,players,rounds_total,round_index,left_score,right_score,choices,phase,\n                 phase_started_at::text,phase_ends_at::text,last_result,winner_side`,\n      [code, userId, choice]\n    );', '    const bot = players.find((player) => player.isBot);\n    const botChoice = bot ? botChoiceAgainst(choice, bot.difficulty ?? "normal") : null;\n    const updated = bot && botChoice ? await client.query<Row>(\n      `update retro_rps_games\n       set choices=coalesce(choices,\'{}\'::jsonb) || jsonb_build_object($2::text,$3::text) || jsonb_build_object($4::text,$5::text),updated_at=now()\n       where room_code=$1\n       returning room_code,status,players,rounds_total,round_index,left_score,right_score,choices,phase,\n                 phase_started_at::text,phase_ends_at::text,last_result,winner_side`,\n      [code, userId, choice, bot.userId, botChoice]\n    ) : await client.query<Row>(\n      `update retro_rps_games\n       set choices=coalesce(choices,\'{}\'::jsonb) || jsonb_build_object($2::text,$3::text),updated_at=now()\n       where room_code=$1\n       returning room_code,status,players,rounds_total,round_index,left_score,right_score,choices,phase,\n                 phase_started_at::text,phase_ends_at::text,last_result,winner_side`,\n      [code, userId, choice]\n    );', "rps bot choice", 1)
t = rep(t, '      if (members.rows.length !== 2) throw new Error("Pierre-Feuille-Ciseaux se joue avec exactement 2 joueurs connectés.");\n      const players: Player[] = [\n        { userId: members.rows[0].id, username: members.rows[0].username, side: "left" },\n        { userId: members.rows[1].id, username: members.rows[1].username, side: "right" },\n      ];', '      const requestedBot = String(data.botDifficulty ?? "");\n      const botDifficulty: BotDifficulty | null = requestedBot === "easy" || requestedBot === "normal" || requestedBot === "hard" ? requestedBot : null;\n      let players: Player[];\n      if (botDifficulty) {\n        const human = members.rows.find((member) => member.id === user.id) ?? members.rows[0];\n        if (!human) throw new Error("Tu dois être dans la room pour jouer contre le bot.");\n        players = [\n          { userId: human.id, username: human.username, side: "left" },\n          { userId: "bot:rps", username: "BOT", side: "right", isBot: true, difficulty: botDifficulty },\n        ];\n      } else {\n        if (members.rows.length !== 2) throw new Error("Pierre-Feuille-Ciseaux se joue avec exactement 2 joueurs connectés.");\n        players = [\n          { userId: members.rows[0].id, username: members.rows[0].username, side: "left" },\n          { userId: members.rows[1].id, username: members.rows[1].username, side: "right" },\n        ];\n      }', "rps bot start server", 1)
save(path, t)

# ---------- RPS CLIENT ----------
path = "app/RpsGame.tsx"
t = load(path)
t = rep(t, 'type Side = "left" | "right";\ntype Choice = "rock" | "paper" | "scissors";\ntype Player = { userId: string; username: string; side: Side };', 'type Side = "left" | "right";\ntype Choice = "rock" | "paper" | "scissors";\ntype BotDifficulty = "easy" | "normal" | "hard";\ntype Player = { userId: string; username: string; side: Side; isBot?: boolean; difficulty?: BotDifficulty };', "rps client types", 1)
t = rep(t, '  const [busy, setBusy] = useState(false);\n  const [error, setError] = useState("");', '  const [busy, setBusy] = useState(false);\n  const [botDifficulty, setBotDifficulty] = useState<BotDifficulty>("normal");\n  const [error, setError] = useState("");', "rps bot state", 1)
t = rep(t, '  const start = async () => {\n    try {\n      setBusy(true); setError("");\n      const data = await post({ action: "start", code: room.code });', '  const start = async (withBot = false) => {\n    try {\n      setBusy(true); setError("");\n      const data = await post({ action: "start", code: room.code, botDifficulty: withBot ? botDifficulty : null });', "rps start client", 1)
t = t.replace('onClick={() => void start()}>{busy ? "Lancement…" : "Lancer le duel"}', 'onClick={() => void start(false)}>{busy ? "Lancement…" : "Lancer le duel"}')
t = rep(t, '      {error && <div className="errorBox rpsLobbyError">{error}</div>\n    </section>;', '      {isHost && online === 1 && <div className="botPlayPanel rpsBotPanel"><div><strong>🤖 Affronter un bot</strong><small>Le bot choisit aussi pendant les 3 secondes.</small></div><select value={botDifficulty} onChange={(event) => setBotDifficulty(event.target.value as BotDifficulty)}><option value="easy">Facile</option><option value="normal">Normal</option><option value="hard">Difficile</option></select><button disabled={busy} onClick={() => void start(true)}>Jouer vs BOT</button></div>}\n      {error && <div className="errorBox rpsLobbyError">{error}</div>\n    </section>;', "rps bot lobby", 1)
save(path, t)

# ---------- GENERIC BOT STYLES ----------
Path("app/bots.css").write_text('''.botPlayPanel{grid-column:1/-1;margin-top:10px;padding:12px 14px;border:1px solid #33414d;border-radius:14px;background:linear-gradient(135deg,rgba(32,48,61,.72),rgba(11,16,22,.92));display:flex;align-items:center;gap:12px}.botPlayPanel>div{display:grid;gap:2px;flex:1}.botPlayPanel strong{font-size:12px}.botPlayPanel small{font-size:9px;color:var(--muted)}.botPlayPanel select{height:36px;border:1px solid #3b4a57;border-radius:10px;background:#0c1218;color:#eef3f5;padding:0 10px;font-weight:800}.botPlayPanel button{height:36px;border:0;border-radius:10px;background:#dce8e1;color:#08110c;font-weight:900;padding:0 14px;cursor:pointer}.botPlayPanel button:disabled{opacity:.45;cursor:not-allowed}.rpsBotPanel{margin:8px 0 0}@media(max-width:650px){.botPlayPanel{display:grid;grid-template-columns:1fr 1fr}.botPlayPanel>div{grid-column:1/-1}.botPlayPanel button,.botPlayPanel select{width:100%}}''')
path = "app/layout.tsx"
t = load(path)
t = rep(t, 'import "./rps.css";', 'import "./rps.css";\nimport "./bots.css";', "bots css import", 1)
save(path, t)

print("Retro bot patch applied successfully")
