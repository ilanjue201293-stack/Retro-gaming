from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected 1 match, found {count}")
    return text.replace(old, new, 1)

client_path = Path("app/DunkshotGame.tsx")
text = client_path.read_text()
text = replace_once(
    text,
    '  const hoop = activeShot ? hoopPosition(activeStreak, activeShot.startedAt) : hoopPosition(activeStreak, sceneTime);',
    '  const hoop = hoopPosition(activeStreak, sceneTime);',
    'live hoop rendering',
)
text = replace_once(
    text,
    '  const shotHoop = hoopPosition(streak, startedAt);\n',
    '',
    'remove frozen client hoop',
)
text = replace_once(
    text,
    '    const hoop = shotHoop;',
    '    const hoop = hoopPosition(streak, startedAt + (t + dt) * 1000);',
    'moving client hoop physics',
)
text = replace_once(
    text,
    '        if (distance > 0.0001 && distance < RIM_COLLISION_RADIUS) {',
    '        if (dy <= 0.002 && distance > 0.0001 && distance < RIM_COLLISION_RADIUS) {',
    'client top-only rim collision',
)
old_shoot = '''  const shoot = async (power: number, aim: number) => {
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
  };'''
new_shoot = '''  const shoot = async (power: number, aim: number) => {
    setAimState(null);
    const maxPowerDrift = power >= 0.97
      ? (Math.random() < 0.5 ? -1 : 1) * (0.045 + Math.random() * 0.055)
      : 0;
    const actualAim = clamp(aim + maxPowerDrift, -1, 1);
    if (soloActive) {
      const shot: Shot = { id: `solo-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, shooterId: user.id, power, aim: actualAim, startedAt: Date.now() + 70 };
      setSoloShot(shot);
      return;
    }
    try {
      const data = await post({ action: "shoot", code: room.code, power, aim: actualAim });
      setGame(data.game as Game);
    } catch (actionError) { setError(actionError instanceof Error ? actionError.message : "Tir impossible."); }
  };'''
text = replace_once(text, old_shoot, new_shoot, 'max-power inaccuracy')
client_path.write_text(text)

server_path = Path("app/api/dunkshot/route.ts")
text = server_path.read_text()
text = replace_once(
    text,
    '  const shotHoop = dunkHoopPosition(streak, shot.startedAt);\n',
    '',
    'remove frozen server hoop',
)
text = replace_once(
    text,
    '    const hoop = shotHoop;',
    '    const hoop = dunkHoopPosition(streak, shot.startedAt + (elapsed + DUNK_STEP) * 1000);',
    'moving server hoop physics',
)
text = replace_once(
    text,
    '        if (distance > 0.0001 && distance < DUNK_RIM_COLLISION_RADIUS) {',
    '        if (dy <= 0.002 && distance > 0.0001 && distance < DUNK_RIM_COLLISION_RADIUS) {',
    'server top-only rim collision',
)
server_path.write_text(text)

print("Patched moving rim, top-only collision, and max-power drift")
