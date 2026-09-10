export type FootballSide = "blue" | "red";
export type FootballDisc = { id: string; side: FootballSide; x: number; y: number };
export type FootballBall = { x: number; y: number };
export type FootballShotResult = { discs: FootballDisc[]; ball: FootballBall; goalSide: FootballSide | null };

export const FOOTBALL_DISC_RADIUS = 0.041;
export const FOOTBALL_BALL_RADIUS = 0.026;
export const FOOTBALL_GOAL_LEFT = 0.34;
export const FOOTBALL_GOAL_RIGHT = 0.66;
const STEP = 1 / 180;
const MAX_STEPS = 420;

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export function freshFootballBall(): FootballBall {
  return { x: 0.5, y: 0.5 };
}

export function initialFootballDiscs(): FootballDisc[] {
  const blue = [[0.5, 0.90], [0.27, 0.75], [0.73, 0.75], [0.37, 0.62], [0.63, 0.62]];
  const red = blue.map(([x, y]) => [x, 1 - y]);
  return [
    ...blue.map(([x, y], index) => ({ id: `blue-${index + 1}`, side: "blue" as const, x, y })),
    ...red.map(([x, y], index) => ({ id: `red-${index + 1}`, side: "red" as const, x, y })),
  ];
}

export function footballDirection(side: FootballSide, aim: number) {
  const angle = clamp(aim, -1, 1) * Math.PI;
  const forward = side === "blue" ? -1 : 1;
  return { x: Math.sin(angle), y: Math.cos(angle) * forward };
}

export function footballAimForVector(side: FootballSide, x: number, y: number) {
  const length = Math.hypot(x, y);
  if (length < 0.000001) return 0;
  const nx = x / length;
  const ny = y / length;
  const forward = side === "blue" ? -1 : 1;
  return clamp(Math.atan2(nx, ny * forward) / Math.PI, -1, 1);
}

export function footballAimForTarget(side: FootballSide, from: { x: number; y: number }, to: { x: number; y: number }) {
  return footballAimForVector(side, to.x - from.x, to.y - from.y);
}

type SimDisc = FootballDisc & { vx: number; vy: number };
type SimBall = FootballBall & { vx: number; vy: number };

function wallDisc(disc: SimDisc) {
  const radius = FOOTBALL_DISC_RADIUS;
  if (disc.x < radius) { disc.x = radius; disc.vx = Math.abs(disc.vx) * 0.70; }
  if (disc.x > 1 - radius) { disc.x = 1 - radius; disc.vx = -Math.abs(disc.vx) * 0.70; }
  if (disc.y < radius) { disc.y = radius; disc.vy = Math.abs(disc.vy) * 0.70; }
  if (disc.y > 1 - radius) { disc.y = 1 - radius; disc.vy = -Math.abs(disc.vy) * 0.70; }
}

function wallBall(ball: SimBall) {
  const radius = FOOTBALL_BALL_RADIUS;
  if (ball.x < radius) { ball.x = radius; ball.vx = Math.abs(ball.vx) * 0.76; }
  if (ball.x > 1 - radius) { ball.x = 1 - radius; ball.vx = -Math.abs(ball.vx) * 0.76; }
  if (ball.y < radius && (ball.x < FOOTBALL_GOAL_LEFT || ball.x > FOOTBALL_GOAL_RIGHT)) {
    ball.y = radius; ball.vy = Math.abs(ball.vy) * 0.76;
  }
  if (ball.y > 1 - radius && (ball.x < FOOTBALL_GOAL_LEFT || ball.x > FOOTBALL_GOAL_RIGHT)) {
    ball.y = 1 - radius; ball.vy = -Math.abs(ball.vy) * 0.76;
  }
}

function goalFor(ball: SimBall): FootballSide | null {
  if (ball.x < FOOTBALL_GOAL_LEFT || ball.x > FOOTBALL_GOAL_RIGHT) return null;
  if (ball.y <= 0.012) return "blue";
  if (ball.y >= 0.988) return "red";
  return null;
}

function resolveDiscPair(a: SimDisc, b: SimDisc) {
  let dx = b.x - a.x;
  let dy = b.y - a.y;
  let distance = Math.hypot(dx, dy);
  const minDistance = FOOTBALL_DISC_RADIUS * 2;
  if (distance >= minDistance) return;
  if (distance < 0.00001) { dx = 0.00001; dy = 0; distance = 0.00001; }
  const nx = dx / distance;
  const ny = dy / distance;
  const overlap = minDistance - distance;
  a.x -= nx * overlap * 0.5;
  a.y -= ny * overlap * 0.5;
  b.x += nx * overlap * 0.5;
  b.y += ny * overlap * 0.5;
  const relative = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
  if (relative >= 0) return;
  const impulse = -(1 + 0.90) * relative / 2;
  a.vx -= impulse * nx;
  a.vy -= impulse * ny;
  b.vx += impulse * nx;
  b.vy += impulse * ny;
}

function resolveBallCollision(disc: SimDisc, ball: SimBall) {
  let dx = ball.x - disc.x;
  let dy = ball.y - disc.y;
  let distance = Math.hypot(dx, dy);
  const minDistance = FOOTBALL_DISC_RADIUS + FOOTBALL_BALL_RADIUS;
  if (distance >= minDistance) return;
  if (distance < 0.00001) { dx = 0; dy = 0.00001; distance = 0.00001; }
  const nx = dx / distance;
  const ny = dy / distance;
  const overlap = minDistance - distance;
  disc.x -= nx * overlap * 0.25;
  disc.y -= ny * overlap * 0.25;
  ball.x += nx * overlap * 0.75;
  ball.y += ny * overlap * 0.75;

  const ballMass = 0.46;
  const invBall = 1 / ballMass;
  const relative = (ball.vx - disc.vx) * nx + (ball.vy - disc.vy) * ny;
  if (relative >= 0) return;
  const impulse = -(1 + 0.92) * relative / (1 + invBall);
  disc.vx -= impulse * nx;
  disc.vy -= impulse * ny;
  ball.vx += impulse * invBall * nx;
  ball.vy += impulse * invBall * ny;
}

export function simulateFootballShot(
  discsInput: FootballDisc[],
  ballInput: FootballBall,
  discId: string,
  side: FootballSide,
  aim: number,
  power: number,
): FootballShotResult {
  const discs: SimDisc[] = discsInput.map((disc) => ({ ...disc, vx: 0, vy: 0 }));
  const ball: SimBall = { ...ballInput, vx: 0, vy: 0 };
  const launcher = discs.find((disc) => disc.id === discId && disc.side === side);
  if (!launcher) throw new Error("Pion introuvable sur le terrain.");

  const direction = footballDirection(side, aim);
  const speed = 0.78 + clamp(power, 0.10, 1) * 1.92;
  launcher.vx = direction.x * speed;
  launcher.vy = direction.y * speed;

  for (let step = 0; step < MAX_STEPS; step++) {
    for (const disc of discs) {
      disc.x += disc.vx * STEP;
      disc.y += disc.vy * STEP;
      wallDisc(disc);
    }
    ball.x += ball.vx * STEP;
    ball.y += ball.vy * STEP;

    const directGoal = goalFor(ball);
    if (directGoal) {
      return {
        discs: discs.map(({ vx: _vx, vy: _vy, ...disc }) => disc),
        ball: { x: ball.x, y: ball.y },
        goalSide: directGoal,
      };
    }
    wallBall(ball);

    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < discs.length; i++) {
        for (let j = i + 1; j < discs.length; j++) resolveDiscPair(discs[i], discs[j]);
      }
      for (const disc of discs) resolveBallCollision(disc, ball);
    }

    const collisionGoal = goalFor(ball);
    if (collisionGoal) {
      return {
        discs: discs.map(({ vx: _vx, vy: _vy, ...disc }) => disc),
        ball: { x: ball.x, y: ball.y },
        goalSide: collisionGoal,
      };
    }

    for (const disc of discs) {
      disc.vx *= 0.987;
      disc.vy *= 0.987;
      if (Math.hypot(disc.vx, disc.vy) < 0.010) { disc.vx = 0; disc.vy = 0; }
    }
    ball.vx *= 0.990;
    ball.vy *= 0.990;
    if (Math.hypot(ball.vx, ball.vy) < 0.009) { ball.vx = 0; ball.vy = 0; }

    if (step > 20 && Math.hypot(ball.vx, ball.vy) === 0 && discs.every((disc) => Math.hypot(disc.vx, disc.vy) === 0)) break;
  }

  return {
    discs: discs.map(({ vx: _vx, vy: _vy, ...disc }) => ({ ...disc, x: clamp(disc.x, FOOTBALL_DISC_RADIUS, 1 - FOOTBALL_DISC_RADIUS), y: clamp(disc.y, FOOTBALL_DISC_RADIUS, 1 - FOOTBALL_DISC_RADIUS) })),
    ball: { x: clamp(ball.x, FOOTBALL_BALL_RADIUS, 1 - FOOTBALL_BALL_RADIUS), y: clamp(ball.y, FOOTBALL_BALL_RADIUS, 1 - FOOTBALL_BALL_RADIUS) },
    goalSide: null,
  };
}
