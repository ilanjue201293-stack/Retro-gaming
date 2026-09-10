export type DunkShot = { id: string; shooterId: string; power: number; aim: number; startedAt: number };
export type DunkSnapshot = { x: number; y: number; rotation: number; inside: boolean; bounceCount: number; made: boolean; done: boolean };
export type DunkTrajectory = { frames: DunkSnapshot[]; made: boolean; duration: number };

export const DUNK_BALL_START_X = 0.5;
export const DUNK_BALL_START_Y = 0.86;
export const DUNK_DURATION = 2.65;
export const DUNK_RIM_Y_OFFSET = 0.065;
const GRAVITY = 2.05;
const STEP = 1 / 120;
const RIM_HALF = 0.064;
const RIM_COLLISION_RADIUS = 0.034;
// Deliberately narrower than the visible rim: the ball centre must really pass through the basket.
const SCORE_HALF = 0.039;
const FLOOR_Y = 0.94;

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export function dunkHoopPosition(streak: number, now: number) {
  if (streak < 2) return { x: 0.5, y: 0.285, moving: false };
  const horizontalAmplitude = Math.min(0.285, 0.085 + (streak - 2) * 0.018);
  const horizontalSpeed = 0.00105 + Math.min(0.00125, streak * 0.000085);
  const x = 0.5 + horizontalAmplitude * Math.sin(now * horizontalSpeed + streak * 1.43);
  if (streak < 6) return { x, y: 0.285, moving: true };
  const verticalAmplitude = Math.min(0.07, 0.018 + (streak - 6) * 0.006);
  const y = 0.285 + verticalAmplitude * Math.sin(now * (0.0008 + streak * 0.000045) + 0.9);
  return { x, y, moving: true };
}

export function buildDunkTrajectory(shot: Pick<DunkShot, "power" | "aim" | "startedAt">, streak: number): DunkTrajectory {
  const power = clamp(shot.power, 0, 1);
  let x = DUNK_BALL_START_X;
  let y = DUNK_BALL_START_Y;
  let vx = clamp(shot.aim, -1, 1) * (0.32 + power * 0.16);
  let vy = -(1.08 + power * 0.83);
  let rotation = 0;
  let made = false;
  let bounceCount = 0;
  let floorBounces = 0;
  const frames: DunkSnapshot[] = [{ x, y, rotation, inside: false, bounceCount, made: false, done: false }];
  let t = 0;
  let sampleAccumulator = 0;

  while (t < DUNK_DURATION) {
    const dt = Math.min(STEP, DUNK_DURATION - t);
    const previousY = y;
    vy += GRAVITY * dt;
    x += vx * dt;
    y += vy * dt;
    rotation += (260 + Math.abs(vx) * 920) * dt * (vx < -0.01 ? -1 : 1);

    const hoop = dunkHoopPosition(streak, shot.startedAt + (t + dt) * 1000);
    const rimY = hoop.y + DUNK_RIM_Y_OFFSET;

    if (!made && floorBounces === 0 && previousY < rimY && y >= rimY && vy > 0 && Math.abs(x - hoop.x) < SCORE_HALF) {
      made = true;
      vx *= 0.48;
      x = x * 0.82 + hoop.x * 0.18;
    }

    if (made && y < rimY + 0.22) {
      x += (hoop.x - x) * Math.min(1, dt * 3.4);
      vx *= Math.pow(0.5, dt);
    }

    if (!made && floorBounces === 0 && vy > 0) {
      for (const rimX of [hoop.x - RIM_HALF, hoop.x + RIM_HALF]) {
        const dx = x - rimX;
        const dy = y - rimY;
        const distance = Math.hypot(dx, dy);
        if (dy <= 0.002 && distance > 0.0001 && distance < RIM_COLLISION_RADIUS) {
          const nx = dx / distance;
          const ny = dy / distance;
          const approach = vx * nx + vy * ny;
          if (approach < 0) {
            const restitution = 0.72;
            vx -= (1 + restitution) * approach * nx;
            vy -= (1 + restitution) * approach * ny;
            vx *= 0.97;
            vy *= 0.97;
            x = rimX + nx * RIM_COLLISION_RADIUS;
            y = rimY + ny * RIM_COLLISION_RADIUS;
            bounceCount += 1;
          }
        }
      }
    }

    if (y >= FLOOR_Y && vy > 0) {
      y = FLOOR_Y;
      vy = -vy * (floorBounces === 0 ? 0.50 : 0.38);
      vx *= 0.76;
      floorBounces += 1;
      bounceCount += 1;
    }

    t += dt;
    sampleAccumulator += dt;
    const done = t >= DUNK_DURATION || Math.abs(x) > 1.4 || (floorBounces >= 2 && Math.abs(vy) < 0.42);
    if (sampleAccumulator >= 1 / 60 || done) {
      frames.push({ x, y, rotation, inside: made, bounceCount, made, done });
      sampleAccumulator = 0;
    }
    if (done) break;
  }

  if (!frames[frames.length - 1]?.done) frames.push({ x, y, rotation, inside: made, bounceCount, made, done: true });
  return { frames, made, duration: Math.min(DUNK_DURATION, Math.max(STEP, t)) };
}

export function dunkSnapshotAt(trajectory: DunkTrajectory, elapsed: number): DunkSnapshot {
  if (elapsed <= 0) return trajectory.frames[0];
  const progress = clamp(elapsed / trajectory.duration, 0, 1);
  const index = Math.min(trajectory.frames.length - 1, Math.floor(progress * (trajectory.frames.length - 1)));
  return trajectory.frames[index];
}

export function dunkshotShotMade(shot: Pick<DunkShot, "power" | "aim" | "startedAt">, streak: number) {
  return buildDunkTrajectory(shot, streak).made;
}
