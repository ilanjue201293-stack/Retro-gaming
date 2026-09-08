from pathlib import Path


def replace_once(path, old, new, label):
    p = Path(path)
    text = p.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected 1 match, got {count}")
    p.write_text(text.replace(old, new, 1))

# Client: authoritative 5s start countdown + frozen paddles during every countdown.
p = Path('app/HockeyGame.tsx')
text = p.read_text()
text = text.replace('const FACEOFF_MS = 3000;\n', 'const INITIAL_COUNTDOWN_MS = 5000;\nconst FACEOFF_MS = 3000;\n', 1)
text = text.replace(
'''function makeFrame(players: Player[], mode: Mode, leftScore = 0, rightScore = 0): Frame {\n  return { puck: { x: 0.5, y: 0.5, vx: 0, vy: 0 }, paddles: Object.fromEntries(players.map((player) => [player.userId, initialPaddle(player, mode)])), leftScore, rightScore, winnerSide: null, pauseUntil: Date.now() };\n}''',
'''function makeFrame(players: Player[], mode: Mode, leftScore = 0, rightScore = 0, pauseUntil = Date.now()): Frame {\n  return { puck: { x: 0.5, y: 0.5, vx: 0, vy: 0 }, paddles: Object.fromEntries(players.map((player) => [player.userId, initialPaddle(player, mode)])), leftScore, rightScore, winnerSide: null, pauseUntil };\n}''',
1)
old_step = '''  for (let step = 0; step < steps; step++) {\n    const remaining = Math.max(1, steps - step);\n    const oldPaddles: Record<string, Paddle> = {};\n    for (const player of players) {\n      const paddle = frame.paddles[player.userId] ?? initialPaddle(player, mode);\n      oldPaddles[player.userId] = { ...paddle };\n      const target = simulation.targets[player.userId] ?? paddle;\n      const nextX = paddle.x + (target.x - paddle.x) / remaining, nextY = paddle.y + (target.y - paddle.y) / remaining;\n      const velocity = capVelocity((nextX - paddle.x) / Math.max(stepDt, 0.001), (nextY - paddle.y) / Math.max(stepDt, 0.001), MAX_MALLET_SPEED);\n      paddle.x = nextX; paddle.y = nextY; paddle.vx = velocity.x; paddle.vy = velocity.y; frame.paddles[player.userId] = paddle;\n    }\n    if (frame.winnerSide || Date.now() < frame.pauseUntil) continue;'''
new_step = '''  for (let step = 0; step < steps; step++) {\n    const remaining = Math.max(1, steps - step);\n    const paused = Date.now() < frame.pauseUntil;\n    const oldPaddles: Record<string, Paddle> = {};\n    for (const player of players) {\n      const paddle = frame.paddles[player.userId] ?? initialPaddle(player, mode);\n      oldPaddles[player.userId] = { ...paddle };\n      if (paused) {\n        const start = initialPaddle(player, mode);\n        frame.paddles[player.userId] = { ...start };\n        simulation.targets[player.userId] = { ...start };\n        continue;\n      }\n      const target = simulation.targets[player.userId] ?? paddle;\n      const nextX = paddle.x + (target.x - paddle.x) / remaining, nextY = paddle.y + (target.y - paddle.y) / remaining;\n      const velocity = capVelocity((nextX - paddle.x) / Math.max(stepDt, 0.001), (nextY - paddle.y) / Math.max(stepDt, 0.001), MAX_MALLET_SPEED);\n      paddle.x = nextX; paddle.y = nextY; paddle.vx = velocity.x; paddle.vy = velocity.y; frame.paddles[player.userId] = paddle;\n    }\n    if (frame.winnerSide || paused) continue;'''
if old_step not in text: raise SystemExit('stepSimulation block missing')
text = text.replace(old_step, new_step, 1)
old_init = '''    signalCursorRef.current = 0; resetLocalToStart(game);\n    if (room.hostId === user.id) {\n      const key = `${game.mode}:${rosterKey}`;\n      if (simulationRef.current?.key !== key) {\n        const initialFrame = makeFrame(game.players, game.mode, game.leftScore, game.rightScore);\n        simulationRef.current = { key, frame: initialFrame, targets: Object.fromEntries(game.players.map((player) => [player.userId, initialPaddle(player, game.mode)])), lastTs: performance.now(), lastBroadcast: 0, lastFallbackBroadcast: 0, lastCheckpointLeft: game.leftScore, lastCheckpointRight: game.rightScore, timeoutResolved: false };\n        setFrame(cloneFrame(initialFrame));\n      }\n    } else if (!frame) setFrame(makeFrame(game.players, game.mode, game.leftScore, game.rightScore));'''
new_init = '''    signalCursorRef.current = 0; resetLocalToStart(game);\n    const initialPauseUntil = Math.max(Date.now(), game.frame?.pauseUntil ?? ((game.startedAt ?? Date.now()) + INITIAL_COUNTDOWN_MS));\n    if (room.hostId === user.id) {\n      const key = `${game.mode}:${rosterKey}`;\n      if (simulationRef.current?.key !== key) {\n        const initialFrame = makeFrame(game.players, game.mode, game.leftScore, game.rightScore, initialPauseUntil);\n        simulationRef.current = { key, frame: initialFrame, targets: Object.fromEntries(game.players.map((player) => [player.userId, initialPaddle(player, game.mode)])), lastTs: performance.now(), lastBroadcast: 0, lastFallbackBroadcast: 0, lastCheckpointLeft: game.leftScore, lastCheckpointRight: game.rightScore, timeoutResolved: false };\n        setFrame(cloneFrame(initialFrame));\n      }\n    } else if (!frame) {\n      const initialFrame = makeFrame(game.players, game.mode, game.leftScore, game.rightScore, initialPauseUntil);\n      remoteSnapshotRef.current = { frame: cloneFrame(initialFrame), receivedAt: performance.now() };\n      setFrame(initialFrame);\n    }'''
if old_init not in text: raise SystemExit('initialization block missing')
text = text.replace(old_init, new_init, 1)
text = text.replace(
'{countdown > 0 && <div className="hockeyCountdown"><b>{countdown}</b><span>REPRISE</span></div>}',
'{countdown > 0 && <div className="hockeyCountdown"><b>{countdown}</b><span>{shown.leftScore === 0 && shown.rightScore === 0 ? "DÉPART" : "REPRISE"}</span></div>}',
1)
p.write_text(text)

# Server: every newly-created match state starts with the same 5 second freeze.
p = Path('lib/hockey-room.ts')
text = p.read_text()
text = text.replace(
'const PUCK_R=.024, MALLET_R=.052, LEFT=.03, RIGHT=.97, TOP=.045, BOTTOM=.955, GOAL_MIN=.36, GOAL_MAX=.64, MAX_PUCK=.82, MAX_MALLET=1.25, DEFAULT_TARGET=7;',
'const PUCK_R=.024, MALLET_R=.052, LEFT=.03, RIGHT=.97, TOP=.045, BOTTOM=.955, GOAL_MIN=.36, GOAL_MAX=.64, MAX_PUCK=.82, MAX_MALLET=1.25, DEFAULT_TARGET=7, INITIAL_COUNTDOWN_MS=5000;',
1)
text = text.replace('pauseUntil:now+650', 'pauseUntil:now+INITIAL_COUNTDOWN_MS', 1)
p.write_text(text)
print('countdown patch applied')
