from pathlib import Path
import re


def replace_once(path, old, new, label):
    p = Path(path)
    text = p.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected 1 match, got {count}")
    p.write_text(text.replace(old, new, 1))


def replace_regex(path, pattern, replacement, label):
    p = Path(path)
    text = p.read_text()
    new, count = re.subn(pattern, replacement, text, count=1, flags=re.S)
    if count != 1:
        raise SystemExit(f"{label}: expected 1 match, got {count}")
    p.write_text(new)

# --- Hockey: restore the networking cadence from the last smooth version ---
replace_once('app/HockeyGame.tsx',
    'timer = window.setTimeout(() => void signalPoll(), directReady ? 1000 : 180);',
    'timer = window.setTimeout(() => void signalPoll(), directReady ? 700 : 90);',
    'hockey signaling cadence')
replace_once('app/HockeyGame.tsx',
    'if (now - simulation.lastFallbackBroadcast >= 280)',
    'if (now - simulation.lastFallbackBroadcast >= 170)',
    'hockey fallback state cadence')
replace_once('app/HockeyGame.tsx',
    'if (force || now - lastFallbackInputSendRef.current >= 130)',
    'if (force || now - lastFallbackInputSendRef.current >= 85)',
    'hockey fallback input cadence')

# Give the hockey bot an actual swing/recover state instead of permanently sitting on the puck.
replace_once('app/HockeyGame.tsx',
'''  timeoutResolved: boolean;\n};''',
'''  timeoutResolved: boolean;\n  botState?: { phase: "setup" | "strike" | "recover"; until: number; aimY: number };\n};''',
'hockey simulation bot state')

hockey_bot = r'''function updateHockeyBot(simulation: Simulation, game: Game, now: number) {
  const bot = game.players.find((player) => player.isBot);
  if (!bot) return;
  const paddle = simulation.frame.paddles[bot.userId] ?? initialPaddle(bot, game.mode);
  const puck = simulation.frame.puck;
  const difficulty = bot.difficulty ?? "normal";
  const baseSpeed = difficulty === "easy" ? 0.40 : difficulty === "hard" ? 0.72 : 0.54;
  const strikeSpeed = difficulty === "easy" ? 0.62 : difficulty === "hard" ? 1.02 : 0.78;
  const aimError = difficulty === "easy" ? 0.10 : difficulty === "hard" ? 0.035 : 0.065;
  const guardX = bot.side === "right" ? 0.82 : 0.18;
  const direction = bot.side === "right" ? -1 : 1;

  if (Date.now() < simulation.frame.pauseUntil) {
    simulation.botState = { phase: "recover", until: now + 350, aimY: 0.5 };
    simulation.targets[bot.userId] = { ...initialPaddle(bot, game.mode) };
    return;
  }

  let state = simulation.botState;
  if (!state) state = simulation.botState = { phase: "setup", until: 0, aimY: puck.y };

  const puckOnBotHalf = bot.side === "right" ? puck.x > 0.50 : puck.x < 0.50;
  const behindX = puck.x - direction * 0.115;
  const strikeX = puck.x + direction * 0.105;
  const wobble = Math.sin(now / 530 + game.leftScore * 1.9 + game.rightScore * 1.3) * aimError;

  let desiredX = guardX;
  let desiredY = clamp(puck.y + wobble, 0.12, 0.88);
  let speed = baseSpeed;

  if (!puckOnBotHalf && state.phase !== "strike") {
    state.phase = "recover";
    state.until = now + 280;
  }

  if (state.phase === "recover") {
    desiredX = guardX;
    desiredY = clamp(0.5 + wobble * 0.5, 0.22, 0.78);
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
}'''
replace_regex('app/HockeyGame.tsx', r'function updateHockeyBot\(simulation: Simulation, game: Game, now: number\) \{.*?\n\}\n\nexport default function HockeyGame', hockey_bot + '\n\nexport default function HockeyGame', 'hockey bot ai')

# --- Pong: slower, imperfect reaction instead of frame-perfect tracking ---
replace_once('app/PongGame.tsx',
'''  timeoutResolved: boolean;\n};''',
'''  timeoutResolved: boolean;\n  botThinkAt?: number;\n  botTargetY?: number;\n};''',
'pong simulation bot state')

pong_bot = r'''function updatePongBot(simulation: Simulation, game: Game, now: number) {
  const bot = game.players.find((player) => player.isBot);
  if (!bot) return;
  const paddle = simulation.frame.paddles[bot.userId] ?? { y: 0.5, vy: 0 };
  const difficulty = bot.difficulty ?? "normal";
  const speed = difficulty === "easy" ? 0.28 : difficulty === "hard" ? 0.58 : 0.40;
  const reactionMs = difficulty === "easy" ? 340 : difficulty === "hard" ? 115 : 215;
  const error = difficulty === "easy" ? 0.17 : difficulty === "hard" ? 0.055 : 0.105;
  const ball = simulation.frame.ball;
  const movingTowardBot = bot.side === "right" ? ball.vx > 0 : ball.vx < 0;

  if (!simulation.botThinkAt || now >= simulation.botThinkAt) {
    simulation.botThinkAt = now + reactionMs;
    const wobble = Math.sin(now / 410 + simulation.frame.leftScore * 1.7 + simulation.frame.rightScore * 0.9) * error;
    if (movingTowardBot) {
      const travel = bot.side === "right" ? Math.max(0, PADDLE_X_RIGHT - ball.x) : Math.max(0, ball.x - PADDLE_X_LEFT);
      const timeToPaddle = Math.min(0.55, travel / Math.max(0.18, Math.abs(ball.vx)));
      simulation.botTargetY = clampPaddleY(ball.y + ball.vy * timeToPaddle * 0.55 + wobble);
    } else {
      simulation.botTargetY = clampPaddleY(0.5 + wobble * 0.45);
    }
  }

  const desired = simulation.botTargetY ?? 0.5;
  const dt = clamp((now - simulation.lastTs) / 1000, 0.008, 0.032);
  const delta = clamp(desired - paddle.y, -speed * dt, speed * dt);
  simulation.targets[bot.userId] = clampPaddleY(paddle.y + delta);
}'''
replace_regex('app/PongGame.tsx', r'function updatePongBot\(simulation: Simulation, game: Game, now: number\) \{.*?\n\}\n\nexport default function PongGame', pong_bot + '\n\nexport default function PongGame', 'pong bot ai')

# --- RPS: bind a click to the exact round so stale network requests cannot become the next round's choice ---
replace_once('app/api/rps/route.ts', 'const CHOICE_NETWORK_GRACE_MS = 650;', 'const CHOICE_NETWORK_GRACE_MS = 1500;', 'rps grace')
replace_once('app/api/rps/route.ts',
'''function botChoiceAgainst(choice: Choice, difficulty: BotDifficulty): Choice {\n  const chance = difficulty === "easy" ? 0.18 : difficulty === "hard" ? 0.68 : 0.4;\n  return Math.random() < chance ? counterChoice(choice) : randomChoice();\n}''',
'''function losingChoice(choice: Choice): Choice { return choice === "rock" ? "scissors" : choice === "paper" ? "rock" : "paper"; }\nfunction botChoiceAgainst(choice: Choice, difficulty: BotDifficulty): Choice {\n  if (difficulty === "easy" && Math.random() < 0.5) return losingChoice(choice);\n  if (difficulty === "hard" && Math.random() < 0.42) return counterChoice(choice);\n  return randomChoice();\n}''',
'rps bot fairness')
replace_once('app/api/rps/route.ts',
'async function recordChoice(code: string, userId: string, choice: Choice) {',
'async function recordChoice(code: string, userId: string, choice: Choice, expectedRoundIndex: number) {',
'rps record signature')
replace_once('app/api/rps/route.ts',
'''    if (!players.some((player) => player.userId === userId)) throw new Error("Tu ne joues pas cette partie.");\n\n    // Un clic reçu juste après 0 s peut être arrivé à temps côté joueur mais subir''',
'''    if (!players.some((player) => player.userId === userId)) throw new Error("Tu ne joues pas cette partie.");\n    if (row.round_index !== expectedRoundIndex) throw new Error("Cette manche est déjà terminée. Choisis pour la suivante.");\n\n    // Un clic reçu juste après 0 s peut être arrivé à temps côté joueur mais subir''',
'rps round guard')
replace_once('app/api/rps/route.ts',
'''      const row = await recordChoice(code, user.id, choice);''',
'''      const roundIndex = Math.max(0, Math.round(Number(data.roundIndex)));\n      const row = await recordChoice(code, user.id, choice, roundIndex);''',
'rps route round index')

# Client keeps the local choice locked until the same round is acknowledged by the server.
replace_once('app/RpsGame.tsx',
'''  const gameRef = useRef<Game | null>(null);''',
'''  const gameRef = useRef<Game | null>(null);\n  const pendingChoiceRef = useRef<{ roundIndex: number; choice: Choice } | null>(null);''',
'rps pending ref')
replace_once('app/RpsGame.tsx',
'''        if (alive) {\n          setGame(data.game as Game);\n          setError("");\n        }''',
'''        if (alive) {\n          const next = data.game as Game;\n          const pending = pendingChoiceRef.current;\n          if (pending && next.status === "playing" && next.phase === "choosing" && next.roundIndex === pending.roundIndex && !next.myChoice) {\n            next.myChoice = pending.choice;\n          } else if (pending && (next.roundIndex !== pending.roundIndex || next.phase !== "choosing" || next.myChoice === pending.choice)) {\n            pendingChoiceRef.current = null;\n          }\n          setGame(next);\n          setError("");\n        }''',
'rps poll choice lock')
replace_once('app/RpsGame.tsx',
'''    const before = game;\n    setGame({ ...game, myChoice: choice });\n    try {\n      setBusy(true); setError("");\n      const data = await post({ action: "choose", code: room.code, choice });\n      setGame(data.game as Game);\n    } catch (actionError) {\n      setGame(before);''',
'''    const before = game;\n    pendingChoiceRef.current = { roundIndex: game.roundIndex, choice };\n    setGame({ ...game, myChoice: choice });\n    try {\n      setBusy(true); setError("");\n      const data = await post({ action: "choose", code: room.code, choice, roundIndex: game.roundIndex });\n      const next = data.game as Game;\n      if (next.phase === "choosing" && next.roundIndex === game.roundIndex && next.myChoice !== choice) throw new Error("Le serveur n'a pas enregistré ton choix. Réessaie.");\n      pendingChoiceRef.current = null;\n      setGame(next);\n    } catch (actionError) {\n      pendingChoiceRef.current = null;\n      setGame(before);''',
'rps choose round binding')

print('Gameplay regression patch applied')
