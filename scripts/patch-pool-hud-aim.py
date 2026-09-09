from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected 1 match, found {count}")
    return text.replace(old, new, 1)

# ---------------- CLIENT ----------------
client_path = Path("app/PoolGame.tsx")
text = client_path.read_text()

text = replace_once(
    text,
    'type Aim = { angle: number; power: number };\ntype Simulation = { balls: Ball[]; accumulator: number; elapsed: number };',
    'type Aim = { angle: number; power: number };\ntype AimPrediction = { ballId: number; x: number; y: number; angle: number };\ntype Simulation = { balls: Ball[]; accumulator: number; elapsed: number };',
    'aim prediction type',
)

needle = '''function groupLabel(group: Group) {
  if (group === "solids") return "PLEINES";
  if (group === "stripes") return "RAYÉES";
  return "LIBRE";
}
'''
addition = needle + '''
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
'''
text = replace_once(text, needle, addition, 'prediction helper')

text = replace_once(
    text,
    '''  const cueBall = visualBalls.find((ball) => ball.id === 0 && !ball.pocketed) ?? baseBalls.find((ball) => ball.id === 0 && !ball.pocketed) ?? null;''',
    '''  const cueBall = visualBalls.find((ball) => ball.id === 0 && !ball.pocketed) ?? baseBalls.find((ball) => ball.id === 0 && !ball.pocketed) ?? null;
  const aimPrediction = cueBall && aim ? predictAimCollision(cueBall, visualBalls, aim.angle) : null;''',
    'aim prediction state',
)

old = '''  const powerClass = !aim ? "" : aim.power < 0.42 ? "low" : aim.power < 0.78 ? "mid" : "high";
  const guideStyle = cueBall && aim ? ({ left: `${cueBall.x * 100}%`, top: `${cueBall.y * 200}%`, transform: `rotate(${aim.angle}rad)` } as CSSProperties) : undefined;

  return <section className="poolGameWrap">'''
new = '''  const powerClass = !aim ? "" : aim.power < 0.42 ? "low" : aim.power < 0.78 ? "mid" : "high";
  const guideStyle = cueBall && aim ? ({ left: `${cueBall.x * 100}%`, top: `${cueBall.y * 200}%`, transform: `rotate(${aim.angle}rad)` } as CSSProperties) : undefined;
  const predictionStyle = aimPrediction ? ({ left: `${aimPrediction.x * 100}%`, top: `${aimPrediction.y * 200}%`, transform: `rotate(${aimPrediction.angle}rad)` } as CSSProperties) : undefined;
  const pocketRail = (player: Player | undefined) => {
    const group = player ? game.groups[player.userId] ?? null : null;
    const ids = group === "solids" ? [1,2,3,4,5,6,7] : group === "stripes" ? [9,10,11,12,13,14,15] : [];
    const pocketed = new Set((game.balls ?? []).filter((ball) => ball.pocketed).map((ball) => ball.id));
    return Array.from({ length: 7 }, (_, index) => {
      const id = ids[index];
      const filled = Boolean(id && pocketed.has(id));
      return <span key={`${player?.userId ?? "empty"}-${index}`} className={`poolHudBall ${filled ? `filled ball-${id}` : ""}`}><i>{filled ? id : ""}</i></span>;
    });
  };

  return <section className="poolGameWrap">'''
text = replace_once(text, old, new, 'hud helper')

old_hud = '''{playerOne && <div className={`poolPlayerHud ${game.status === "playing" && game.turnIndex === 0 ? "turn" : ""}`}><small>{groupLabel(game.groups[playerOne.userId])}</small><strong>{playerOne.username}</strong></div>}<div className="poolHudCenter"><small>TOUR</small><strong>{currentPlayer?.username ?? "—"}</strong></div>{playerTwo && <div className={`poolPlayerHud right ${game.status === "playing" && game.turnIndex === 1 ? "turn" : ""}`}><small>{groupLabel(game.groups[playerTwo.userId])}</small><strong>{playerTwo.username}</strong></div>}'''
new_hud = '''{playerOne && <div className={`poolPlayerHud ${game.status === "playing" && game.turnIndex === 0 ? "turn" : ""}`}><small>{groupLabel(game.groups[playerOne.userId])}</small><strong>{playerOne.username}</strong><div className="poolHudBalls">{pocketRail(playerOne)}</div></div>}<div className="poolHudCenter"><small>TOUR</small><strong>{currentPlayer?.username ?? "—"}</strong></div>{playerTwo && <div className={`poolPlayerHud right ${game.status === "playing" && game.turnIndex === 1 ? "turn" : ""}`}><small>{groupLabel(game.groups[playerTwo.userId])}</small><strong>{playerTwo.username}</strong><div className="poolHudBalls right">{pocketRail(playerTwo)}</div></div>}'''
text = replace_once(text, old_hud, new_hud, 'player hud rails')

old_guide = '''      {aim && cueBall && !activeShot && <><div className="poolGuide" style={guideStyle}><span/></div><div className={`poolCueWrap ${powerClass}`} style={guideStyle}><div className="poolCueStick" style={{ width: `${150 + aim.power * 150}px`, right: `${22 + aim.power * 72}px` }}/></div></>}'''
new_guide = '''      {aim && cueBall && !activeShot && <><div className="poolGuide" style={guideStyle}><span/></div>{aimPrediction && <div className="poolTargetPrediction" style={predictionStyle}><i/></div>}<div className={`poolCueWrap ${powerClass}`} style={guideStyle}><div className="poolCueStick" style={{ width: `${150 + aim.power * 150}px`, right: `${22 + aim.power * 72}px` }}/></div></>}'''
text = replace_once(text, old_guide, new_guide, 'target direction guide')

client_path.write_text(text)

# ---------------- CSS ----------------
css_path = Path("app/pool.css")
css = css_path.read_text()
css += '''\n\n/* Pool HUD pocket rails + object-ball prediction */
.poolPlayerHud{grid-template-rows:auto auto auto}.poolHudBalls{display:flex;gap:5px;align-items:center;margin-top:5px;min-height:18px}.poolHudBalls.right{justify-content:flex-end}.poolHudBall{width:18px;height:18px;border-radius:50%;display:grid;place-items:center;background:#303943;border:1px solid #46515d;box-shadow:inset 0 2px 4px rgba(255,255,255,.05),inset 0 -3px 5px rgba(0,0,0,.2)}.poolHudBall.filled{border-color:rgba(255,255,255,.24);box-shadow:inset -3px -4px 5px rgba(0,0,0,.26),inset 2px 2px 4px rgba(255,255,255,.2),0 2px 5px rgba(0,0,0,.3)}.poolHudBall i{width:45%;aspect-ratio:1;border-radius:50%;display:grid;place-items:center;background:transparent;color:transparent;font-size:6px;font-style:normal;font-weight:950;line-height:1}.poolHudBall.filled i{background:#f5f3eb;color:#141414}.poolTargetPrediction{position:absolute;z-index:13;width:1px;height:1px;transform-origin:0 0;pointer-events:none}.poolTargetPrediction i{position:absolute;left:18px;top:-1px;width:72px;height:3px;border-radius:999px;background:linear-gradient(90deg,rgba(255,255,255,.92),rgba(255,255,255,.2));box-shadow:0 0 6px rgba(255,255,255,.2)}.poolTargetPrediction i:after{content:"";position:absolute;right:-2px;top:50%;width:6px;height:6px;border-top:2px solid rgba(255,255,255,.72);border-right:2px solid rgba(255,255,255,.72);transform:translateY(-50%) rotate(45deg)}
@media(max-width:600px){.poolHudBall{width:13px;height:13px}.poolHudBalls{gap:3px}.poolHudBall i{font-size:5px}.poolTargetPrediction i{left:13px;width:48px}}
'''
css_path.write_text(css)

# ---------------- SERVER RULES ----------------
server_path = Path("app/api/pool/route.ts")
server = server_path.read_text()
server = replace_once(
    server,
    'type Simulation = { balls: Ball[]; elapsed: number };',
    'type Simulation = { balls: Ball[]; elapsed: number; pocketOrder: number[] };',
    'server simulation type',
)
server = replace_once(
    server,
    '''      if (Math.hypot(ball.x - pocket.x, ball.y - pocket.y) <= POCKET_R) { ball.x = pocket.x; ball.y = pocket.y; ball.vx = 0; ball.vy = 0; ball.pocketed = true; break; }''',
    '''      if (Math.hypot(ball.x - pocket.x, ball.y - pocket.y) <= POCKET_R) { ball.x = pocket.x; ball.y = pocket.y; ball.vx = 0; ball.vy = 0; ball.pocketed = true; simulation.pocketOrder.push(ball.id); break; }''',
    'pocket temporal order',
)
server = replace_once(
    server,
    '''  const simulation: Simulation = { balls, elapsed: 0 };
  while (simulation.elapsed < MAX_SHOT_TIME && simulation.balls.some((ball) => !ball.pocketed && Math.hypot(ball.vx, ball.vy) >= STOP_SPEED)) stepSimulation(simulation);
  return simulation.balls;''',
    '''  const simulation: Simulation = { balls, elapsed: 0, pocketOrder: [] };
  while (simulation.elapsed < MAX_SHOT_TIME && simulation.balls.some((ball) => !ball.pocketed && Math.hypot(ball.vx, ball.vy) >= STOP_SPEED)) stepSimulation(simulation);
  return { balls: simulation.balls, pocketOrder: simulation.pocketOrder };''',
    'simulation return order',
)
server = replace_once(
    server,
    '''        const before = parseBalls(current.balls); const simulated = simulateShot(before, shot);
        const previouslyPocketed = new Set(before.filter((ball) => ball.pocketed).map((ball) => ball.id));
        const pocketed = simulated.filter((ball) => ball.pocketed && !previouslyPocketed.has(ball.id)).map((ball) => ball.id);
        const scratch = pocketed.includes(0); const black = pocketed.includes(8);''',
    '''        const before = parseBalls(current.balls); const simulationResult = simulateShot(before, shot); const simulated = simulationResult.balls;
        const previouslyPocketed = new Set(before.filter((ball) => ball.pocketed).map((ball) => ball.id));
        const pocketed = simulationResult.pocketOrder.filter((id) => !previouslyPocketed.has(id));
        const scratch = pocketed.includes(0); const black = pocketed.includes(8);''',
    'resolve temporal pocket list',
)

old_rules = '''        const groups = parseGroups(current.groups);
        let shooterGroup = groups[shooter.userId] ?? null;
        if (!shooterGroup) {
          const firstColored = pocketed.find((id) => id !== 0 && id !== 8);
          const assigned = firstColored ? ballGroup(firstColored) : null;
          if (assigned) { shooterGroup = assigned; groups[shooter.userId] = assigned; groups[opponent.userId] = assigned === "solids" ? "stripes" : "solids"; }
        }
        let winnerId: string | null = null;
        if (black) {
          const ownRemaining = shooterGroup ? simulated.some((ball) => !ball.pocketed && ballGroup(ball.id) === shooterGroup) : simulated.some((ball) => !ball.pocketed && ball.id !== 0 && ball.id !== 8);
          winnerId = !scratch && !ownRemaining ? shooter.userId : opponent.userId;
        }
        const pocketedOwn = Boolean(shooterGroup && pocketed.some((id) => ballGroup(id) === shooterGroup));
        const nextTurn = winnerId ? shooterIndex : (!scratch && pocketedOwn ? shooterIndex : (shooterIndex + 1) % players.length);
        const finalBalls = respawnCue(simulated);
        let message = "Aucune bille empochée.";
        if (winnerId) message = winnerId === shooter.userId ? "Noire empochée : victoire !" : "Noire empochée trop tôt : défaite.";
        else if (scratch) message = "Faute : blanche empochée. Tour adverse.";
        else if (pocketedOwn) message = `${shooter.username} garde la main.`;
        else if (pocketed.some((id) => id !== 0)) message = "Bille empochée, mais le tour change.";
        if (shooterGroup && !parseGroups(current.groups)[shooter.userId]) message = `${shooter.username} joue les ${shooterGroup === "solids" ? "pleines" : "rayées"}.`;'''
new_rules = '''        const groups = parseGroups(current.groups);
        const wasUnassigned = !groups[shooter.userId];
        let shooterGroup = groups[shooter.userId] ?? null;
        if (!shooterGroup) {
          const firstColored = pocketed.find((id) => id !== 0 && id !== 8);
          const assigned = firstColored ? ballGroup(firstColored) : null;
          if (assigned) { shooterGroup = assigned; groups[shooter.userId] = assigned; groups[opponent.userId] = assigned === "solids" ? "stripes" : "solids"; }
        }
        const opponentGroup = groups[opponent.userId] ?? (shooterGroup === "solids" ? "stripes" : shooterGroup === "stripes" ? "solids" : null);
        let winnerId: string | null = null;
        if (black) {
          const ownRemaining = shooterGroup ? simulated.some((ball) => !ball.pocketed && ballGroup(ball.id) === shooterGroup) : simulated.some((ball) => !ball.pocketed && ball.id !== 0 && ball.id !== 8);
          winnerId = !scratch && !ownRemaining ? shooter.userId : opponent.userId;
        }
        const pocketedOwn = Boolean(shooterGroup && pocketed.some((id) => ballGroup(id) === shooterGroup));
        const pocketedWrong = Boolean(opponentGroup && pocketed.some((id) => ballGroup(id) === opponentGroup));
        const nextTurn = winnerId ? shooterIndex : (!scratch && pocketedOwn && !pocketedWrong ? shooterIndex : (shooterIndex + 1) % players.length);
        const finalBalls = respawnCue(simulated);
        let message = "Aucune bille empochée.";
        if (winnerId) message = winnerId === shooter.userId ? "Noire empochée : victoire !" : "Noire empochée trop tôt : défaite.";
        else if (scratch) message = "Faute : blanche empochée. Tour adverse.";
        else if (pocketedWrong) message = `Mauvaise bille empochée : ${opponent.username} récupère la main.`;
        else if (pocketedOwn) message = `${shooter.username} garde la main.`;
        else if (pocketed.some((id) => id !== 0)) message = "Bille empochée, mais le tour change.";
        if (wasUnassigned && shooterGroup) {
          const assignment = `${shooter.username} prend les ${shooterGroup === "solids" ? "pleines" : "rayées"}.`;
          message = pocketedWrong ? `${assignment} Une bille adverse est aussi tombée : tour à ${opponent.username}.` : pocketedOwn ? `${assignment} Il garde la main.` : assignment;
        }'''
server = replace_once(server, old_rules, new_rules, 'strict pool turn/group rules')
server_path.write_text(server)

print("Patched Pool HUD, assignment order, wrong-ball turns, and aim prediction")
