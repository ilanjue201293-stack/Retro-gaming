from pathlib import Path

path = Path('app/api/dunkshot/route.ts')
text = path.read_text()

anchor = '''function parseResult(value: unknown): LastResult | null {\n  if (!value || typeof value !== "object" || Array.isArray(value)) return null;\n  const raw = value as Partial<LastResult>;\n  if (!raw.shotId || !raw.shooterId) return null;\n  return { shotId: String(raw.shotId), shooterId: String(raw.shooterId), made: Boolean(raw.made), at: Number(raw.at) || Date.now() };\n}\n'''

insert = anchor + '''\nconst DUNK_BALL_START_X = 0.5;\nconst DUNK_BALL_START_Y = 0.86;\nconst DUNK_GRAVITY = 1.95;\n\nfunction dunkClamp(value: number, min: number, max: number) {\n  return Math.max(min, Math.min(max, value));\n}\n\nfunction dunkTrajectory(power: number, aim: number, elapsed: number) {\n  const initialY = -(1.30 + dunkClamp(power, 0, 1) * 0.55);\n  const initialX = dunkClamp(aim, -1, 1) * (0.34 + dunkClamp(power, 0, 1) * 0.10);\n  return {\n    x: DUNK_BALL_START_X + initialX * elapsed,\n    y: DUNK_BALL_START_Y + initialY * elapsed + 0.5 * DUNK_GRAVITY * elapsed * elapsed,\n    velocityY: initialY + DUNK_GRAVITY * elapsed,\n  };\n}\n\nfunction dunkHoopPosition(streak: number, now: number) {\n  if (streak < 2) return { x: 0.5, y: 0.285 };\n  const horizontalAmplitude = Math.min(0.285, 0.085 + (streak - 2) * 0.018);\n  const horizontalSpeed = 0.00105 + Math.min(0.00125, streak * 0.000085);\n  const x = 0.5 + horizontalAmplitude * Math.sin(now * horizontalSpeed + streak * 1.43);\n  if (streak < 6) return { x, y: 0.285 };\n  const verticalAmplitude = Math.min(0.07, 0.018 + (streak - 6) * 0.006);\n  const y = 0.285 + verticalAmplitude * Math.sin(now * (0.0008 + streak * 0.000045) + 0.9);\n  return { x, y };\n}\n\nfunction dunkshotShotMade(shot: Shot, streak: number) {\n  let lastY = DUNK_BALL_START_Y;\n  const step = 1 / 240;\n  for (let elapsed = 0; elapsed <= 2.15; elapsed += step) {\n    const point = dunkTrajectory(shot.power, shot.aim, elapsed);\n    const hoop = dunkHoopPosition(streak, shot.startedAt + elapsed * 1000);\n    const rimY = hoop.y + 0.065;\n    if (lastY < rimY && point.y >= rimY && point.velocityY > 0 && Math.abs(point.x - hoop.x) <= 0.071) return true;\n    lastY = point.y;\n    if ((elapsed > 0.55 && point.y > 1.14) || Math.abs(point.x) > 1.28) break;\n  }\n  return false;\n}\n'''

if anchor not in text:
    raise SystemExit('parseResult anchor not found')
text = text.replace(anchor, insert, 1)
old = '        const made = Boolean(data.made);\n'
new = '        const made = dunkshotShotMade(shot, Math.max(0, Number(current.streak) || 0));\n'
if old not in text:
    raise SystemExit('made line not found')
text = text.replace(old, new, 1)
path.write_text(text)
