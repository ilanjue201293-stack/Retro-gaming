from pathlib import Path
import re


def replace_once(path, old, new, label):
    p = Path(path)
    text = p.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected 1 match, got {count}")
    p.write_text(text.replace(old, new, 1))

# ---------------- Hockey client ----------------
p = Path('app/HockeyGame.tsx')
text = p.read_text()
text = text.replace('type Mode = "1v1" | "2v2";', 'type Mode = "1v1" | "2v1" | "2v2";', 1)
text = text.replace('  botState?: { phase: "setup" | "strike" | "recover"; until: number; aimY: number };', '  botStates?: Record<string, { phase: "setup" | "strike" | "recover"; until: number; aimY: number }>;', 1)
text = text.replace('  return { x: player.side === "left" ? 0.2 : 0.8, y: mode === "1v1" ? 0.5 : player.slot === 0 ? 0.34 : 0.66, vx: 0, vy: 0 };', '  return { x: player.side === "left" ? 0.2 : 0.8, y: player.slot < 0 ? 0.5 : player.slot === 0 ? 0.34 : 0.66, vx: 0, vy: 0 };', 1)

marker = 'const formatClock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.max(0, seconds % 60)).padStart(2, "0")}`;\n'
insert = marker + '''function teamCaps(mode: Mode, twoPlayerSide: Side) {\n  if (mode === "1v1") return { left: 1, right: 1 };\n  if (mode === "2v2") return { left: 2, right: 2 };\n  return twoPlayerSide === "left" ? { left: 2, right: 1 } : { left: 1, right: 2 };\n}\n'''
if marker not in text: raise SystemExit('teamCaps marker missing')
text = text.replace(marker, insert, 1)

start = text.index('function updateHockeyBot(')
end = text.index('\nexport default function HockeyGame', start)
new_bot = r'''function updateHockeyBots(simulation: Simulation, game: Game, now: number) {
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
'''
text = text[:start] + new_bot + text[end:]
text = text.replace('      updateHockeyBot(simulation, current, now);', '      updateHockeyBots(simulation, current, now);', 1)

old_state = '  const [botDifficulty, setBotDifficulty] = useState<BotDifficulty>("normal");\n  const [frame, setFrame] = useState<Frame | null>(null);'
new_state = '  const [botDifficulty, setBotDifficulty] = useState<BotDifficulty>("normal");\n  const [teamAssignments, setTeamAssignments] = useState<Record<string, Side | "bench">>({});\n  const [twoPlayerSide, setTwoPlayerSide] = useState<Side>("left");\n  const [focusSuppressed, setFocusSuppressed] = useState(false);\n  const [frame, setFrame] = useState<Frame | null>(null);'
if old_state not in text: raise SystemExit('hockey state marker missing')
text = text.replace(old_state, new_state, 1)

old_memos = '  const needed = game?.mode === "2v2" ? 4 : 2;\n  const online = room.members.filter((member) => member.online).length;'
new_memos = '''  const needed = game?.mode === "2v2" ? 4 : game?.mode === "2v1" ? 3 : 2;\n  const onlineMembers = useMemo(() => room.members.filter((member) => member.online), [room.members]);\n  const online = onlineMembers.length;\n  const caps = teamCaps(game?.mode ?? "1v1", twoPlayerSide);\n  const leftHumans = onlineMembers.filter((member) => teamAssignments[member.id] === "left").length;\n  const rightHumans = onlineMembers.filter((member) => teamAssignments[member.id] === "right").length;\n  const selectedHumans = leftHumans + rightHumans;\n  const missingBots = Math.max(0, caps.left - leftHumans) + Math.max(0, caps.right - rightHumans);'''
if old_memos not in text: raise SystemExit('hockey memos marker missing')
text = text.replace(old_memos, new_memos, 1)

apply_marker = '  const applyGame = useCallback((next: Game) => { gameRef.current = next; setGame(next); setError(""); }, []);\n'
apply_insert = apply_marker + r'''  useEffect(() => {
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
  }, [game?.status, game?.mode, isHost, onlineMembers, twoPlayerSide]);

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
    const returnToRoom = () => setFocusSuppressed(true);
    window.addEventListener("retro:return-room", returnToRoom);
    return () => window.removeEventListener("retro:return-room", returnToRoom);
  }, []);
'''
if apply_marker not in text: raise SystemExit('hockey apply marker missing')
text = text.replace(apply_marker, apply_insert, 1)

old_body_effect = '  useEffect(() => { const active = game?.status === "playing" || game?.status === "gameover"; document.body.classList.toggle("hockey-match-active", Boolean(active)); return () => document.body.classList.remove("hockey-match-active"); }, [game?.status]);'
new_body_effect = '  useEffect(() => { const active = (game?.status === "playing" || game?.status === "gameover") && !focusSuppressed; document.body.classList.toggle("hockey-match-active", Boolean(active)); return () => document.body.classList.remove("hockey-match-active"); }, [game?.status, focusSuppressed]);'
if old_body_effect not in text: raise SystemExit('hockey body effect marker missing')
text = text.replace(old_body_effect, new_body_effect, 1)

old_config_start = '''  const configure = async (mode: Mode, targetScore: number, timeLimitSec: number) => {
    try { setBusy(true); applyGame((await post({ action: "hockeyConfigure", code: room.code, mode, targetScore, timeLimitSec })).game as Game); }
    catch (actionError) { setError(actionError instanceof Error ? actionError.message : "Erreur."); }
    finally { setBusy(false); }
  };
  const start = async (withBot = false) => { try { setBusy(true); signalCursorRef.current = 0; closeAllPeers(); applyGame((await post({ action: "hockeyStart", code: room.code, botDifficulty: withBot ? botDifficulty : null })).game as Game); setClock(Date.now()); } catch (actionError) { setError(actionError instanceof Error ? actionError.message : "Erreur."); } finally { setBusy(false); } };
'''
new_config_start = '''  const configure = async (mode: Mode, targetScore: number, timeLimitSec: number) => {
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
'''
if old_config_start not in text: raise SystemExit('hockey config/start marker missing')
text = text.replace(old_config_start, new_config_start, 1)

old_modes = '''      <div className="modePicker">
        <button className={game.mode === "1v1" ? "selected" : ""} disabled={!isHost || busy} onClick={() => void configure("1v1", game.targetScore, game.timeLimitSec)}><strong>1 VS 1</strong><small>2 joueurs</small></button>
        <button className={game.mode === "2v2" ? "selected" : ""} disabled={!isHost || busy} onClick={() => void configure("2v2", game.targetScore, game.timeLimitSec)}><strong>2 VS 2</strong><small>4 joueurs</small></button>
      </div>'''
new_modes = '''      <div className="modePicker hockeyModePicker3">
        <button className={game.mode === "1v1" ? "selected" : ""} disabled={!isHost || busy} onClick={() => void configure("1v1", game.targetScore, game.timeLimitSec)}><strong>1 VS 1</strong><small>2 joueurs</small></button>
        <button className={game.mode === "2v1" ? "selected" : ""} disabled={!isHost || busy} onClick={() => void configure("2v1", game.targetScore, game.timeLimitSec)}><strong>2 VS 1</strong><small>3 joueurs</small></button>
        <button className={game.mode === "2v2" ? "selected" : ""} disabled={!isHost || busy} onClick={() => void configure("2v2", game.targetScore, game.timeLimitSec)}><strong>2 VS 2</strong><small>4 joueurs</small></button>
      </div>'''
if old_modes not in text: raise SystemExit('hockey modes marker missing')
text = text.replace(old_modes, new_modes, 1)

old_ready = '''      <div className="hockeyReadyBar"><span>{online}/{needed} joueurs connectés</span>{isHost ? <button className="primaryButton" disabled={busy || online < needed} onClick={() => void start(false)}>{busy ? "Lancement…" : `Lancer le ${game.mode}`}</button> : <small>En attente de l'hôte…</small>}</div>
      {isHost && game.mode === "1v1" && online === 1 && <div className="botPlayPanel"><div><strong>🤖 Personne avec qui jouer ?</strong><small>Lance un 1v1 contre un bot.</small></div><select value={botDifficulty} onChange={(event) => setBotDifficulty(event.target.value as BotDifficulty)}><option value="easy">Facile</option><option value="normal">Normal</option><option value="hard">Difficile</option></select><button disabled={busy} onClick={() => void start(true)}>Jouer contre le bot</button></div>}
'''
new_ready = '''      {isHost && <div className="hockeyTeamSetup">
        <div className="hockeyTeamSetupHead"><div><strong>Équipes</strong><small>Choisis qui joue en bleu, rouge ou reste sur le banc.</small></div>{game.mode === "2v1" && <div className="twoPlayerSidePicker"><span>Équipe à 2</span><button className={twoPlayerSide === "left" ? "active blue" : ""} onClick={() => setTwoPlayerSide("left")}>BLEU</button><button className={twoPlayerSide === "right" ? "active red" : ""} onClick={() => setTwoPlayerSide("right")}>ROUGE</button></div>}</div>
        <div className="hockeyTeamRows">{onlineMembers.map((member) => <div className="hockeyTeamRow" key={member.id}><strong>{member.username}{member.id === user.id ? " (toi)" : ""}</strong><div><button className={teamAssignments[member.id] === "left" ? "selected blue" : ""} onClick={() => assignTeam(member.id, "left")}>BLEU</button><button className={teamAssignments[member.id] === "right" ? "selected red" : ""} onClick={() => assignTeam(member.id, "right")}>ROUGE</button><button className={teamAssignments[member.id] === "bench" ? "selected bench" : ""} onClick={() => assignTeam(member.id, "bench")}>BANC</button></div></div>)}</div>
        <div className="hockeyTeamCounts"><span className={leftHumans === caps.left ? "full" : ""}>Bleu {leftHumans}/{caps.left}</span><span className={rightHumans === caps.right ? "full" : ""}>Rouge {rightHumans}/{caps.right}</span></div>
      </div>}
      <div className="hockeyReadyBar"><span>{selectedHumans}/{needed} places humaines remplies</span>{isHost && missingBots === 0 ? <button className="primaryButton" disabled={busy} onClick={() => void start(false)}>{busy ? "Lancement…" : `Lancer le ${game.mode}`}</button> : !isHost ? <small>En attente de l'hôte…</small> : <small>{missingBots} place{missingBots > 1 ? "s" : ""} libre{missingBots > 1 ? "s" : ""}</small>}</div>
      {isHost && missingBots > 0 && selectedHumans > 0 && <div className="botPlayPanel"><div><strong>🤖 Compléter avec des bots</strong><small>Ajoute automatiquement {missingBots} bot{missingBots > 1 ? "s" : ""} dans les places libres.</small></div><select value={botDifficulty} onChange={(event) => setBotDifficulty(event.target.value as BotDifficulty)}><option value="easy">Facile</option><option value="normal">Normal</option><option value="hard">Difficile</option></select><button disabled={busy} onClick={() => void start(true)}>Compléter et lancer</button></div>}
'''
if old_ready not in text: raise SystemExit('hockey ready marker missing')
text = text.replace(old_ready, new_ready, 1)

fallback_marker = '  const fallback = makeFrame(game.players, game.mode, game.leftScore, game.rightScore);\n'
compact = '''  if (focusSuppressed && game.status !== "lobby") return <section className="gameInProgressCard"><div><span className="kicker">HOCKEY EN COURS</span><h2>Match en cours</h2><p>Tu es revenu dans la room. Le match continue en arrière-plan.</p></div><button className="primaryButton" onClick={() => setFocusSuppressed(false)}>Revenir au match</button></section>;\n\n''' + fallback_marker
if fallback_marker not in text: raise SystemExit('hockey fallback marker missing')
text = text.replace(fallback_marker, compact, 1)

old_winner = '{shown.winnerSide && <div className="hockeyWinnerOverlay"><span>🏆</span><h2>{winners || "Équipe"} gagne !</h2><p>{shown.leftScore} — {shown.rightScore}</p></div>}'
new_winner = '{shown.winnerSide && <div className="hockeyWinnerOverlay"><span>🏆</span><h2>{winners || "Équipe"} gagne !</h2><p>{shown.leftScore} — {shown.rightScore}</p>{isHost ? <div className="gameEndActions"><button className="primaryButton" disabled={busy} onClick={() => void replay()}>Rejouer</button><button className="secondaryButton" disabled={busy} onClick={() => void stop()}>Lobby du jeu</button></div> : <small>En attente de l\'hôte pour rejouer.</small>}</div>}'
if old_winner not in text: raise SystemExit('hockey winner marker missing')
text = text.replace(old_winner, new_winner, 1)
p.write_text(text)

# ---------------- Hockey backend ----------------
p = Path('lib/hockey-room.ts')
text = p.read_text()
text = text.replace('export type HockeyMode = "1v1" | "2v2";', 'export type HockeyMode = "1v1" | "2v1" | "2v2";', 1)
text = text.replace('function initial(p:Player,mode:HockeyMode):Paddle{return{x:p.side==="left"?.2:.8,y:mode==="1v1"?.5:p.slot===0?.34:.66,vx:0,vy:0}}', 'function initial(p:Player,mode:HockeyMode):Paddle{return{x:p.side==="left"?.2:.8,y:p.slot<0?.5:p.slot===0?.34:.66,vx:0,vy:0}}', 1)
old_start_begin = 'export async function hockeyStart(code:string,userId:string,botDifficulty:BotDifficulty|null=null){\n'
if old_start_begin not in text: raise SystemExit('backend start begin missing')
start = text.index(old_start_begin)
end = text.index('\nexport async function hockeyStop', start)
new_start = r'''export async function hockeyStart(code:string,userId:string,botDifficulty:BotDifficulty|null=null,teamAssignments:Record<string,"left"|"right"|"bench">={},twoPlayerSide:Side="left",fillBots=false){
  if(await host(code)!==userId)throw new Error("Seul l'hôte peut lancer le match.");
  const r=await row(code),current=decode(r.players,r);
  const capacities=r.mode==="1v1"?{left:1,right:1}:r.mode==="2v2"?{left:2,right:2}:twoPlayerSide==="right"?{left:1,right:2}:{left:2,right:1};
  const need=capacities.left+capacities.right;
  const members=await db().query<{id:string;username:string;avatar_data:string|null}>(`select u.id,u.username,u.avatar_data from retro_room_members m join retro_users u on u.id=m.user_id where m.room_code=$1 and m.last_seen>now()-interval '15 seconds' order by m.joined_at`,[code]);
  const memberById=new Map(members.rows.map(m=>[m.id,m]));
  const hasAssignments=Object.keys(teamAssignments||{}).length>0;
  const chosen:{member:{id:string;username:string;avatar_data:string|null};side:Side}[]=[];
  if(hasAssignments){
    for(const [id,rawSide] of Object.entries(teamAssignments||{})){
      if(rawSide!=="left"&&rawSide!=="right")continue;
      const member=memberById.get(id);if(member)chosen.push({member,side:rawSide});
    }
  }else{
    let left=0,right=0;
    for(const member of members.rows.slice(0,need)){
      if(left<capacities.left){chosen.push({member,side:"left"});left++;}
      else if(right<capacities.right){chosen.push({member,side:"right"});right++;}
    }
  }
  const leftHumans=chosen.filter(v=>v.side==="left");
  const rightHumans=chosen.filter(v=>v.side==="right");
  if(leftHumans.length>capacities.left||rightHumans.length>capacities.right)throw new Error("Il y a trop de joueurs dans une des équipes.");
  if(chosen.length===0)throw new Error("Sélectionne au moins un joueur humain.");
  const missing=(capacities.left-leftHumans.length)+(capacities.right-rightHumans.length);
  if(missing>0&&!fillBots)throw new Error(`Il manque ${missing} joueur${missing>1?"s":""}. Complète avec des bots ou change les équipes.`);
  const difficulty:BotDifficulty=botDifficulty??"normal";
  const roster:Player[]=[];
  const buildSide=(side:Side,humans:typeof chosen,capacity:number)=>{
    const entries:Player[]=humans.map(v=>({userId:v.member.id,username:v.member.username,avatarData:v.member.avatar_data,side,slot:0}));
    while(entries.length<capacity){const index=entries.length;entries.push({userId:`bot:hockey:${side}:${index}`,username:`BOT ${side==="left"?"BLEU":"ROUGE"} ${index+1}`,avatarData:null,side,slot:0,isBot:true,difficulty});}
    entries.forEach((player,index)=>{player.slot=entries.length===1?-1:index;roster.push(player);});
  };
  buildSide("left",leftHumans,capacities.left);
  buildSide("right",rightHumans,capacities.right);
  const now=Date.now(),frame=fresh(roster,r.mode,now),inputs=Object.fromEntries(roster.map(p=>[p.userId,{...initial(p,r.mode),at:now}])),s:Stored={roster,frame,inputs,lastTick:now,targetScore:current.targetScore,timeLimitSec:current.timeLimitSec,startedAt:now};
  await db().query(`update retro_hockey_games set status='playing',players=$1::jsonb,left_score=0,right_score=0,winner_side=null,updated_at=now() where room_code=$2`,[JSON.stringify(s),code]);
  return output({...r,status:"playing",players:s,left_score:0,right_score:0,winner_side:null},s);
}'''
text = text[:start] + new_start + text[end:]
p.write_text(text)

# ---------------- Rooms hockey route ----------------
p = Path('app/api/rooms/route.ts')
text = p.read_text()
text = text.replace('            data.mode === "2v2" ? "2v2" : "1v1" as HockeyMode,', '            data.mode === "2v2" ? "2v2" : data.mode === "2v1" ? "2v1" : "1v1" as HockeyMode,', 1)
old_call = '        return NextResponse.json({ ok: true, game: await hockeyStart(code, user.id, botDifficulty) });'
new_call = '''        const rawAssignments = data.teamAssignments && typeof data.teamAssignments === "object" && !Array.isArray(data.teamAssignments) ? data.teamAssignments as Record<string, unknown> : {};
        const teamAssignments: Record<string, "left" | "right" | "bench"> = {};
        for (const [id, side] of Object.entries(rawAssignments)) if (side === "left" || side === "right" || side === "bench") teamAssignments[id] = side;
        const twoPlayerSide = data.twoPlayerSide === "right" ? "right" : "left";
        const fillBots = Boolean(data.fillBots);
        return NextResponse.json({ ok: true, game: await hockeyStart(code, user.id, botDifficulty, teamAssignments, twoPlayerSide, fillBots) });'''
if old_call not in text: raise SystemExit('rooms hockeyStart call missing')
text = text.replace(old_call, new_call, 1)
p.write_text(text)

# ---------------- Pong client ----------------
p = Path('app/PongGame.tsx')
text = p.read_text()
old = '  const [botDifficulty, setBotDifficulty] = useState<BotDifficulty>("normal");\n  const [clock, setClock] = useState(Date.now());'
new = '  const [botDifficulty, setBotDifficulty] = useState<BotDifficulty>("normal");\n  const [focusSuppressed, setFocusSuppressed] = useState(false);\n  const [clock, setClock] = useState(Date.now());'
if old not in text: raise SystemExit('pong state marker missing')
text = text.replace(old,new,1)
old = '''  useEffect(() => {
    const active = game?.status === "playing" || game?.status === "gameover";
    document.body.classList.toggle("pong-match-active", Boolean(active));
    return () => document.body.classList.remove("pong-match-active");
  }, [game?.status]);'''
new = '''  useEffect(() => {
    const active = (game?.status === "playing" || game?.status === "gameover") && !focusSuppressed;
    document.body.classList.toggle("pong-match-active", Boolean(active));
    return () => document.body.classList.remove("pong-match-active");
  }, [game?.status, focusSuppressed]);
  useEffect(() => { if (game?.status === "lobby") setFocusSuppressed(false); }, [game?.status]);
  useEffect(() => {
    const returnToRoom = () => setFocusSuppressed(true);
    window.addEventListener("retro:return-room", returnToRoom);
    return () => window.removeEventListener("retro:return-room", returnToRoom);
  }, []);'''
if old not in text: raise SystemExit('pong body effect missing')
text = text.replace(old,new,1)
start_marker = '''  const start = async (withBot = false) => {
    try {
      setBusy(true); setError(""); closeAllPeers(); signalCursorRef.current = 0;
      const data = await post({ action: "start", code: room.code, botDifficulty: withBot ? botDifficulty : null });
      gameRef.current = data.game as Game;
      setGame(data.game as Game);
      setClock(Date.now());
    } catch (startError) { setError(startError instanceof Error ? startError.message : "Impossible de lancer Pong."); }
    finally { setBusy(false); }
  };
'''
replacement = start_marker + '''  const stop = async () => {
    try { setBusy(true); setError(""); const data = await post({ action: "stop", code: room.code }); gameRef.current = data.game as Game; setGame(data.game as Game); setFocusSuppressed(false); }
    catch (stopError) { setError(stopError instanceof Error ? stopError.message : "Impossible de revenir au lobby Pong."); }
    finally { setBusy(false); }
  };
'''
if start_marker not in text: raise SystemExit('pong start marker missing')
text = text.replace(start_marker,replacement,1)
shown_marker = '  const shown = frame ?? makeFrame(game.players, game.leftScore, game.rightScore);\n'
compact = '  if (focusSuppressed && game.status !== "lobby") return <section className="gameInProgressCard"><div><span className="kicker">PONG EN COURS</span><h2>Partie en cours</h2><p>Tu es revenu dans la room. Pong continue en arrière-plan.</p></div><button className="primaryButton" onClick={() => setFocusSuppressed(false)}>Revenir au match</button></section>;\n\n' + shown_marker
if shown_marker not in text: raise SystemExit('pong shown marker missing')
text = text.replace(shown_marker,compact,1)
old = '{shown.winnerSide && <div className="pongWinner"><strong>{winner || "Joueur"} gagne</strong><span>{shown.leftScore} — {shown.rightScore}</span>{isHost && <button onClick={() => void start(Boolean(game.players.some((player) => player.isBot)))}>Rejouer</button>}</div>}'
new = '{shown.winnerSide && <div className="pongWinner"><strong>{winner || "Joueur"} gagne</strong><span>{shown.leftScore} — {shown.rightScore}</span>{isHost ? <div className="gameEndActions"><button onClick={() => void start(Boolean(game.players.some((player) => player.isBot)))}>Rejouer</button><button onClick={() => void stop()}>Lobby du jeu</button></div> : <small>En attente de l\'hôte pour rejouer.</small>}</div>}'
if old not in text: raise SystemExit('pong winner marker missing')
text = text.replace(old,new,1)
p.write_text(text)

# ---------------- RPS client ----------------
p = Path('app/RpsGame.tsx')
text = p.read_text()
old = '  const [botDifficulty, setBotDifficulty] = useState<BotDifficulty>("normal");\n  const [error, setError] = useState("");'
new = '  const [botDifficulty, setBotDifficulty] = useState<BotDifficulty>("normal");\n  const [focusSuppressed, setFocusSuppressed] = useState(false);\n  const [error, setError] = useState("");'
if old not in text: raise SystemExit('rps state marker missing')
text=text.replace(old,new,1)
old = '''  useEffect(() => {
    const active = game?.status === "playing" || game?.status === "gameover";
    document.body.classList.toggle("rps-match-active", Boolean(active));
    return () => document.body.classList.remove("rps-match-active");
  }, [game?.status]);'''
new = '''  useEffect(() => {
    const active = (game?.status === "playing" || game?.status === "gameover") && !focusSuppressed;
    document.body.classList.toggle("rps-match-active", Boolean(active));
    return () => document.body.classList.remove("rps-match-active");
  }, [game?.status, focusSuppressed]);
  useEffect(() => { if (game?.status === "lobby") setFocusSuppressed(false); }, [game?.status]);
  useEffect(() => {
    const returnToRoom = () => setFocusSuppressed(true);
    window.addEventListener("retro:return-room", returnToRoom);
    return () => window.removeEventListener("retro:return-room", returnToRoom);
  }, []);'''
if old not in text: raise SystemExit('rps body effect missing')
text=text.replace(old,new,1)
result_marker = '  const result = game.lastResult;\n'
compact = '  if (focusSuppressed && game.status !== "lobby") return <section className="gameInProgressCard"><div><span className="kicker">DUEL EN COURS</span><h2>Pierre · Feuille · Ciseaux</h2><p>Tu es revenu dans la room. Le duel continue en arrière-plan.</p></div><button className="primaryButton" onClick={() => setFocusSuppressed(false)}>Revenir au duel</button></section>;\n\n' + result_marker
if result_marker not in text: raise SystemExit('rps result marker missing')
text=text.replace(result_marker,compact,1)
old = '{isHost && <button className="primaryButton" disabled={busy} onClick={() => void stop()}>Retour aux jeux</button>}'
new = '{isHost ? <div className="gameEndActions"><button className="primaryButton" disabled={busy} onClick={() => void start(Boolean(game.players.some((player) => player.isBot)))}>Rejouer</button><button className="secondaryButton" disabled={busy} onClick={() => void stop()}>Lobby du jeu</button></div> : <small>En attente de l\'hôte pour rejouer.</small>}'
if old not in text: raise SystemExit('rps gameover button missing')
text=text.replace(old,new,1)
p.write_text(text)

# ---------------- Retro room topbar ----------------
p = Path('app/RetroApp.tsx')
text = p.read_text()
old = '''          <button className="roomCode" onClick={() => navigator.clipboard?.writeText(room.code).then(() => setToast("Code copié"))}>
            <small>ROOM</small><strong>{room.code}</strong><span>⧉</span>
          </button>
          <button className="ghostButton dangerText" onClick={() => void leaveRoom()}>Quitter</button>'''
new = '''          <button className="roomCode" onClick={() => navigator.clipboard?.writeText(room.code).then(() => setToast("Code copié"))}>
            <small>ROOM</small><strong>{room.code}</strong><span>⧉</span>
          </button>
          <button className="ghostButton returnRoomButton" onClick={() => window.dispatchEvent(new Event("retro:return-room"))}>← Retour à la room</button>
          <button className="ghostButton dangerText" onClick={() => void leaveRoom()}>Quitter</button>'''
if old not in text: raise SystemExit('Retro topbar marker missing')
text=text.replace(old,new,1)
text=text.replace('Joue en 1v1 ou 2v2, au doigt ou à la souris.', 'Joue en 1v1, 2v1 ou 2v2, choisis les équipes et complète avec des bots.', 1)
p.write_text(text)

# ---------------- CSS ----------------
p = Path('app/hockey-v6.css')
css = p.read_text()
css += r'''
.hockeyModePicker3{grid-template-columns:repeat(3,1fr)}
.hockeyTeamSetup{margin:14px 0;border:1px solid #293744;background:#0a1016;border-radius:15px;padding:12px;display:grid;gap:10px}.hockeyTeamSetupHead{display:flex;align-items:center;justify-content:space-between;gap:12px}.hockeyTeamSetupHead>div:first-child{display:grid;gap:2px}.hockeyTeamSetupHead strong{font-size:12px}.hockeyTeamSetupHead small{font-size:9px;color:#7f8c98}.twoPlayerSidePicker{display:flex!important;align-items:center;gap:5px}.twoPlayerSidePicker span{font-size:8px;color:#7f8c98;font-weight:900;margin-right:3px}.twoPlayerSidePicker button,.hockeyTeamRow button{border:1px solid #35424e;background:#121a22;color:#9aa8b3;border-radius:8px;padding:6px 8px;font-size:8px;font-weight:950;cursor:pointer}.twoPlayerSidePicker button.active.blue,.hockeyTeamRow button.selected.blue{border-color:#5bbcff;background:rgba(70,165,230,.18);color:#a9ddff}.twoPlayerSidePicker button.active.red,.hockeyTeamRow button.selected.red{border-color:#ff7887;background:rgba(225,70,90,.16);color:#ffb2bb}.hockeyTeamRow button.selected.bench{border-color:#78838d;background:#202831;color:#d0d7dc}.hockeyTeamRows{display:grid;gap:6px}.hockeyTeamRow{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:7px 8px;border-radius:10px;background:#0e151c;border:1px solid #202b35}.hockeyTeamRow>strong{font-size:10px}.hockeyTeamRow>div{display:flex;gap:5px}.hockeyTeamCounts{display:flex;gap:8px}.hockeyTeamCounts span{font-size:8px;font-weight:900;color:#7e8b97;border:1px solid #2b3742;border-radius:999px;padding:5px 8px}.hockeyTeamCounts span.full{color:#8fefbd;border-color:rgba(143,239,189,.3);background:rgba(143,239,189,.06)}
.gameEndActions{display:flex;gap:8px;justify-content:center;flex-wrap:wrap}.hockeyWinnerOverlay .gameEndActions button{min-width:130px}.gameInProgressCard{margin-top:16px;border:1px solid #2a3742;background:linear-gradient(135deg,#0d141b,#0a0f14);border-radius:18px;padding:18px;display:flex;align-items:center;justify-content:space-between;gap:18px}.gameInProgressCard h2{margin:3px 0;font-size:22px}.gameInProgressCard p{margin:0;color:#7f8d99;font-size:10px}.returnRoomButton{display:none}
body.hockey-match-active .returnRoomButton,body.pong-match-active .returnRoomButton,body.rps-match-active .returnRoomButton{display:inline-flex!important}
@media(max-width:650px){.hockeyModePicker3{grid-template-columns:1fr}.hockeyTeamSetupHead,.hockeyTeamRow,.gameInProgressCard{align-items:stretch;flex-direction:column}.hockeyTeamRow>div{width:100%}.hockeyTeamRow button{flex:1}.twoPlayerSidePicker{flex-wrap:wrap}.gameInProgressCard .primaryButton{width:100%}}
'''
p.write_text(css)

p = Path('app/pong.css')
css = p.read_text()
css += '\n.pongWinner .gameEndActions{display:flex;gap:9px;flex-wrap:wrap;justify-content:center}.pongWinner .gameEndActions button{margin-top:8px}\n'
p.write_text(css)

p = Path('app/rps.css')
css = p.read_text()
css += '\n.rpsGameOver .gameEndActions{display:flex;gap:9px;justify-content:center;flex-wrap:wrap}.rpsGameOver .gameEndActions button{min-width:130px}\n'
p.write_text(css)

print('patch applied')
