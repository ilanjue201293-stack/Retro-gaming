import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth";
import { db } from "@/lib/db";
import { cleanRoomCode, makeId, sha256 } from "@/lib/utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type BotDifficulty = "easy" | "normal" | "hard";
type Player = { userId: string; username: string; isBot?: boolean; difficulty?: BotDifficulty };
type Group = "solids" | "stripes" | null;
type Ball = { id: number; x: number; y: number; vx: number; vy: number; pocketed: boolean };
type Shot = { id: string; shooterId: string; angle: number; power: number; startedAt: number };
type Row = { room_code: string; status: "lobby" | "playing" | "gameover"; players: unknown; turn_index: number; balls: unknown; groups: unknown; shot: unknown; winner_id: string | null; last_message: string | null };

type Simulation = { balls: Ball[]; elapsed: number; pocketOrder: number[] };
const BALL_R = 0.013;
const STEP = 1 / 180;
const MAX_SHOT_TIME = 6.5;
const LEFT = 0.032;
const RIGHT = 0.968;
const TOP = 0.032;
const BOTTOM = 0.468;
const POCKET_R = 0.032;
const STOP_SPEED = 0.011;
const POCKETS = [
  { x: 0.035, y: 0.035 }, { x: 0.5, y: 0.025 }, { x: 0.965, y: 0.035 },
  { x: 0.035, y: 0.465 }, { x: 0.5, y: 0.475 }, { x: 0.965, y: 0.465 },
];
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const cloneBalls = (balls: Ball[]) => balls.map((ball) => ({ ...ball }));

function rackBalls(): Ball[] {
  const balls: Ball[] = [{ id: 0, x: 0.255, y: 0.25, vx: 0, vy: 0, pocketed: false }];
  const ids = [1, 9, 2, 10, 8, 3, 11, 4, 12, 5, 13, 6, 14, 7, 15];
  let index = 0;
  for (let row = 0; row < 5; row++) {
    const x = 0.69 + row * 0.024;
    for (let slot = 0; slot <= row; slot++) balls.push({ id: ids[index++], x, y: 0.25 + (slot - row / 2) * 0.0274, vx: 0, vy: 0, pocketed: false });
  }
  return balls;
}

function parsePlayers(value: unknown): Player[] {
  return Array.isArray(value) ? value.filter((entry): entry is Player => Boolean(entry && typeof entry === "object" && "userId" in entry && "username" in entry)) : [];
}
function parseBalls(value: unknown): Ball[] {
  if (!Array.isArray(value)) return rackBalls();
  const balls = value.filter((entry): entry is Ball => Boolean(entry && typeof entry === "object" && "id" in entry && "x" in entry && "y" in entry)).map((entry) => ({
    id: Number(entry.id), x: Number(entry.x), y: Number(entry.y), vx: Number(entry.vx) || 0, vy: Number(entry.vy) || 0, pocketed: Boolean(entry.pocketed),
  }));
  return balls.length === 16 ? balls : rackBalls();
}
function parseGroups(value: unknown): Record<string, Group> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result: Record<string, Group> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) result[key] = raw === "solids" || raw === "stripes" ? raw : null;
  return result;
}
function parseShot(value: unknown): Shot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Partial<Shot>;
  if (!raw.id || !raw.shooterId) return null;
  return { id: String(raw.id), shooterId: String(raw.shooterId), angle: Number(raw.angle) || 0, power: clamp(Number(raw.power) || 0, 0, 1), startedAt: Number(raw.startedAt) || Date.now() };
}
function ballGroup(id: number): Exclude<Group, null> | null {
  if (id >= 1 && id <= 7) return "solids";
  if (id >= 9 && id <= 15) return "stripes";
  return null;
}

function chooseBotShot(balls: Ball[], group: Group, difficulty: BotDifficulty) {
  const cue = balls.find((ball) => ball.id === 0 && !ball.pocketed);
  if (!cue) return { angle: 0, power: 0.55 };
  let targets = balls.filter((ball) => !ball.pocketed && ball.id !== 0 && ball.id !== 8 && (!group || ballGroup(ball.id) === group));
  if (!targets.length) targets = balls.filter((ball) => !ball.pocketed && ball.id === 8);
  if (!targets.length) return { angle: 0, power: 0.55 };
  const choices: { angle: number; power: number; score: number }[] = [];
  for (const target of targets) {
    for (const pocket of POCKETS) {
      const tx = pocket.x - target.x, ty = pocket.y - target.y, targetDistance = Math.hypot(tx, ty);
      if (targetDistance < 0.001) continue;
      const ux = tx / targetDistance, uy = ty / targetDistance;
      const ghostX = target.x - ux * BALL_R * 2.08, ghostY = target.y - uy * BALL_R * 2.08;
      if (ghostX < LEFT || ghostX > RIGHT || ghostY < TOP || ghostY > BOTTOM) continue;
      const cueDistance = Math.hypot(ghostX - cue.x, ghostY - cue.y);
      const angle = Math.atan2(ghostY - cue.y, ghostX - cue.x);
      const power = clamp(0.4 + cueDistance * 0.42 + targetDistance * 0.46, 0.42, 0.92);
      choices.push({ angle, power, score: targetDistance + cueDistance * 0.42 });
    }
  }
  choices.sort((a, b) => a.score - b.score);
  const take = difficulty === "easy" ? Math.min(10, choices.length) : difficulty === "hard" ? Math.min(2, choices.length) : Math.min(5, choices.length);
  const selected = choices[Math.floor(Math.random() * Math.max(1, take))] ?? { angle: Math.atan2(targets[0].y - cue.y, targets[0].x - cue.x), power: 0.62, score: 0 };
  const error = difficulty === "easy" ? 0.11 : difficulty === "hard" ? 0.018 : 0.05;
  const powerNoise = difficulty === "easy" ? 0.12 : difficulty === "hard" ? 0.025 : 0.06;
  return { angle: selected.angle + (Math.random() * 2 - 1) * error, power: clamp(selected.power + (Math.random() * 2 - 1) * powerNoise, 0.32, 0.96) };
}

function respawnCue(balls: Ball[]) {
  const next = cloneBalls(balls);
  const cue = next.find((ball) => ball.id === 0);
  if (!cue || !cue.pocketed) return next;
  const candidates = [{ x: 0.255, y: 0.25 }, { x: 0.22, y: 0.20 }, { x: 0.22, y: 0.30 }, { x: 0.30, y: 0.20 }, { x: 0.30, y: 0.30 }];
  const spot = candidates.find((candidate) => next.every((ball) => ball.id === 0 || ball.pocketed || Math.hypot(ball.x - candidate.x, ball.y - candidate.y) > BALL_R * 2.2)) ?? candidates[0];
  cue.x = spot.x; cue.y = spot.y; cue.vx = 0; cue.vy = 0; cue.pocketed = false;
  return next;
}

function stepSimulation(simulation: Simulation) {
  const balls = simulation.balls;
  for (const ball of balls) {
    if (ball.pocketed) continue;
    ball.x += ball.vx * STEP; ball.y += ball.vy * STEP;
    for (const pocket of POCKETS) {
      if (Math.hypot(ball.x - pocket.x, ball.y - pocket.y) <= POCKET_R) { ball.x = pocket.x; ball.y = pocket.y; ball.vx = 0; ball.vy = 0; ball.pocketed = true; simulation.pocketOrder.push(ball.id); break; }
    }
    if (ball.pocketed) continue;
    if (ball.x - BALL_R < LEFT) { ball.x = LEFT + BALL_R; ball.vx = Math.abs(ball.vx) * 0.91; }
    else if (ball.x + BALL_R > RIGHT) { ball.x = RIGHT - BALL_R; ball.vx = -Math.abs(ball.vx) * 0.91; }
    if (ball.y - BALL_R < TOP) { ball.y = TOP + BALL_R; ball.vy = Math.abs(ball.vy) * 0.91; }
    else if (ball.y + BALL_R > BOTTOM) { ball.y = BOTTOM - BALL_R; ball.vy = -Math.abs(ball.vy) * 0.91; }
  }
  for (let ai = 0; ai < balls.length; ai++) {
    const a = balls[ai]; if (a.pocketed) continue;
    for (let bi = ai + 1; bi < balls.length; bi++) {
      const b = balls[bi]; if (b.pocketed) continue;
      let dx = b.x - a.x, dy = b.y - a.y, distance = Math.hypot(dx, dy);
      const minimum = BALL_R * 2;
      if (distance >= minimum) continue;
      if (distance < 0.000001) { dx = minimum; dy = 0; distance = minimum; }
      const nx = dx / distance, ny = dy / distance, overlap = minimum - distance;
      a.x -= nx * overlap * 0.5; a.y -= ny * overlap * 0.5; b.x += nx * overlap * 0.5; b.y += ny * overlap * 0.5;
      const relative = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
      if (relative < 0) {
        const impulse = -(1 + 0.94) * relative / 2;
        a.vx -= impulse * nx; a.vy -= impulse * ny; b.vx += impulse * nx; b.vy += impulse * ny;
      }
    }
  }
  const friction = Math.pow(0.989, STEP * 60);
  for (const ball of balls) {
    if (ball.pocketed) continue;
    ball.vx *= friction; ball.vy *= friction;
    if (Math.hypot(ball.vx, ball.vy) < STOP_SPEED) { ball.vx = 0; ball.vy = 0; }
  }
  simulation.elapsed += STEP;
}

function simulateShot(source: Ball[], shot: Shot) {
  const balls = cloneBalls(source);
  const cue = balls.find((ball) => ball.id === 0 && !ball.pocketed);
  if (cue) {
    const speed = 0.34 + clamp(shot.power, 0, 1) * 1.25;
    cue.vx = Math.cos(shot.angle) * speed; cue.vy = Math.sin(shot.angle) * speed;
  }
  const simulation: Simulation = { balls, elapsed: 0, pocketOrder: [] };
  while (simulation.elapsed < MAX_SHOT_TIME && simulation.balls.some((ball) => !ball.pocketed && Math.hypot(ball.vx, ball.vy) >= STOP_SPEED)) stepSimulation(simulation);
  return { balls: simulation.balls, pocketOrder: simulation.pocketOrder };
}

let schemaPromise: Promise<void> | null = null;
async function ensureSchema() {
  if (!schemaPromise) schemaPromise = db().query(`
    create table if not exists retro_pool_games (
      room_code text primary key references retro_rooms(code) on delete cascade,
      status text not null default 'lobby',
      players jsonb not null default '[]'::jsonb,
      turn_index integer not null default 0,
      balls jsonb not null default '[]'::jsonb,
      groups jsonb not null default '{}'::jsonb,
      shot jsonb,
      winner_id text,
      last_message text,
      updated_at timestamptz not null default now()
    );
    alter table retro_pool_games add column if not exists turn_index integer not null default 0;
    alter table retro_pool_games add column if not exists balls jsonb not null default '[]'::jsonb;
    alter table retro_pool_games add column if not exists groups jsonb not null default '{}'::jsonb;
    alter table retro_pool_games add column if not exists shot jsonb;
    alter table retro_pool_games add column if not exists winner_id text;
    alter table retro_pool_games add column if not exists last_message text;
  `).then(() => undefined).catch((error) => { schemaPromise = null; throw error; });
  await schemaPromise;
}
async function body(req: NextRequest) { try { return await req.json(); } catch { return {}; } }
async function authInRoom(req: NextRequest, code: string) {
  const token = req.cookies.get(SESSION_COOKIE)?.value; if (!token) throw new Error("AUTH_REQUIRED");
  const result = await db().query<{ id: string; username: string }>(`select u.id,u.username from retro_sessions s join retro_users u on u.id=s.user_id join retro_room_members m on m.user_id=u.id and m.room_code=$2 join retro_rooms r on r.code=m.room_code where s.token_hash=$1 and s.expires_at>now() and r.expires_at>now() limit 1`, [sha256(token), code]);
  if (!result.rows[0]) throw new Error("Tu n'es pas dans cette room."); return result.rows[0];
}
async function hostId(code: string) {
  const result = await db().query<{ host_user_id: string }>(`select host_user_id from retro_rooms where code=$1 and expires_at>now() limit 1`, [code]);
  if (!result.rows[0]) throw new Error("Room introuvable ou expirée."); return result.rows[0].host_user_id;
}
async function ensureGame(code: string) { await ensureSchema(); await db().query(`insert into retro_pool_games(room_code,balls) values($1,$2::jsonb) on conflict(room_code) do nothing`, [code, JSON.stringify(rackBalls())]); }
function output(row: Row) { return { status: row.status, players: parsePlayers(row.players), turnIndex: Math.max(0, Number(row.turn_index) || 0), balls: parseBalls(row.balls), groups: parseGroups(row.groups), shot: parseShot(row.shot), winnerId: row.winner_id, lastMessage: row.last_message }; }
async function row(code: string) {
  await ensureGame(code);
  const result = await db().query<Row>(`select room_code,status,players,turn_index,balls,groups,shot,winner_id,last_message from retro_pool_games where room_code=$1 limit 1`, [code]);
  if (!result.rows[0]) throw new Error("Billard indisponible."); return result.rows[0];
}
async function resetOtherGames(code: string) {
  await db().query(`update retro_hockey_games set status='lobby',players='[]'::jsonb,left_score=0,right_score=0,winner_side=null,updated_at=now() where room_code=$1`, [code]).catch(() => undefined);
  await db().query(`update retro_pong_games set status='lobby',players='[]'::jsonb,left_score=0,right_score=0,winner_side=null,started_at=null,updated_at=now() where room_code=$1`, [code]).catch(() => undefined);
  await db().query(`update retro_rps_games set status='lobby',players='[]'::jsonb,round_index=0,left_score=0,right_score=0,choices='{}'::jsonb,phase='choosing',phase_started_at=null,phase_ends_at=null,last_result=null,winner_side=null,updated_at=now() where room_code=$1`, [code]).catch(() => undefined);
  await db().query(`update retro_dunkshot_games set status='lobby',players='[]'::jsonb,lives='{}'::jsonb,turn_index=0,streak=0,shot=null,last_result=null,winner_id=null,started_at=null,ends_at=null,updated_at=now() where room_code=$1`, [code]).catch(() => undefined);
}
async function state(code: string) {
  return output(await row(code));
}

export async function POST(req: NextRequest) {
  try {
    const data = await body(req); const code = cleanRoomCode(data.code); const action = String(data.action ?? "state"); const user = await authInRoom(req, code); await ensureGame(code);
    if (action === "state") return NextResponse.json({ ok: true, game: await state(code) });

    if (action === "start") {
      if (await hostId(code) !== user.id) throw new Error("Seul l'hôte peut lancer le billard.");
      const opponentId = String(data.opponentId ?? "");
      const requestedBot = String(data.botDifficulty ?? "");
      const botDifficulty: BotDifficulty | null = requestedBot === "easy" || requestedBot === "normal" || requestedBot === "hard" ? requestedBot : null;
      const members = await db().query<{ id: string; username: string }>(`select u.id,u.username from retro_room_members m join retro_users u on u.id=m.user_id where m.room_code=$1 and m.last_seen>now()-interval '15 seconds' order by m.joined_at`, [code]);
      const host = members.rows.find((member) => member.id === user.id);
      const opponent = members.rows.find((member) => member.id === opponentId && member.id !== user.id) ?? members.rows.find((member) => member.id !== user.id);
      if (!host || (!botDifficulty && !opponent)) throw new Error("Il faut 2 joueurs connectés ou choisir un bot.");
      const players: Player[] = [{ userId: host.id, username: host.username }, botDifficulty ? { userId: "bot:pool", username: "BOT", isBot: true, difficulty: botDifficulty } : { userId: opponent!.id, username: opponent!.username }];
      await resetOtherGames(code);
      await db().query(`update retro_pool_games set status='playing',players=$1::jsonb,turn_index=0,balls=$2::jsonb,groups='{}'::jsonb,shot=null,winner_id=null,last_message='Casse la table.',updated_at=now() where room_code=$3`, [JSON.stringify(players), JSON.stringify(rackBalls()), code]);
      return NextResponse.json({ ok: true, game: await state(code) });
    }

    if (action === "shoot") {
      const client = await db().connect();
      try {
        await client.query("begin");
        const result = await client.query<Row>(`select room_code,status,players,turn_index,balls,groups,shot,winner_id,last_message from retro_pool_games where room_code=$1 for update`, [code]);
        const current = result.rows[0]; if (!current || current.status !== "playing") throw new Error("La partie n'est pas en cours.");
        const players = parsePlayers(current.players); const shooter = players[Math.max(0, current.turn_index) % Math.max(1, players.length)];
        if (!shooter || shooter.userId !== user.id) throw new Error("Ce n'est pas ton tour.");
        if (parseShot(current.shot)) throw new Error("Les billes roulent déjà.");
        const power = clamp(Number(data.power) || 0, 0, 1); if (power < 0.05) throw new Error("Coup trop faible.");
        const angle = Number(data.angle) || 0;
        const requestedShotId = String(data.shotId ?? "");
        const shotId = /^[A-Za-z0-9:_-]{8,120}$/.test(requestedShotId) ? requestedShotId : makeId();
        const now = Date.now();
        const requestedStartedAt = Number(data.startedAt);
        const startedAt = Number.isFinite(requestedStartedAt) && requestedStartedAt >= now - 1500 && requestedStartedAt <= now + 300 ? requestedStartedAt : now + 20;
        const shot: Shot = { id: shotId, shooterId: user.id, angle, power, startedAt };
        await client.query(`update retro_pool_games set shot=$1::jsonb,last_message=null,updated_at=now() where room_code=$2`, [JSON.stringify(shot), code]);
        await client.query("commit"); return NextResponse.json({ ok: true, game: await state(code) });
      } catch (error) { await client.query("rollback"); throw error; } finally { client.release(); }
    }

    if (action === "botShoot") {
      if (await hostId(code) !== user.id) throw new Error("Seul l'hôte peut faire jouer le bot.");
      const client = await db().connect();
      try {
        await client.query("begin");
        const result = await client.query<Row>(`select room_code,status,players,turn_index,balls,groups,shot,winner_id,last_message from retro_pool_games where room_code=$1 for update`, [code]);
        const current = result.rows[0]; if (!current || current.status !== "playing") throw new Error("La partie n'est pas en cours.");
        if (parseShot(current.shot)) { await client.query("rollback"); return NextResponse.json({ ok: true, game: await state(code) }); }
        const players = parsePlayers(current.players);
        const bot = players[Math.max(0, current.turn_index) % Math.max(1, players.length)];
        if (!bot?.isBot) throw new Error("Ce n'est pas au bot de jouer.");
        const groups = parseGroups(current.groups);
        const choice = chooseBotShot(parseBalls(current.balls), groups[bot.userId] ?? null, bot.difficulty ?? "normal");
        const shot: Shot = { id: makeId(), shooterId: bot.userId, angle: choice.angle, power: choice.power, startedAt: Date.now() + 40 };
        await client.query(`update retro_pool_games set shot=$1::jsonb,last_message=$2,updated_at=now() where room_code=$3`, [JSON.stringify(shot), `${bot.username} prépare son tir…`, code]);
        await client.query("commit"); return NextResponse.json({ ok: true, game: await state(code) });
      } catch (error) { try { await client.query("rollback"); } catch {} throw error; } finally { client.release(); }
    }

    if (action === "resolve") {
      const client = await db().connect();
      try {
        await client.query("begin");
        const result = await client.query<Row>(`select room_code,status,players,turn_index,balls,groups,shot,winner_id,last_message from retro_pool_games where room_code=$1 for update`, [code]);
        const current = result.rows[0];
        if (!current || current.status !== "playing") { await client.query("rollback"); return NextResponse.json({ ok: true, game: await state(code) }); }
        const shot = parseShot(current.shot); const shotId = String(data.shotId ?? "");
        if (!shot || shot.id !== shotId) { await client.query("rollback"); return NextResponse.json({ ok: true, game: await state(code) }); }
        const players = parsePlayers(current.players); const shooterIndex = Math.max(0, current.turn_index) % Math.max(1, players.length); const shooter = players[shooterIndex]; const opponent = players[(shooterIndex + 1) % players.length];
        if (!shooter || !opponent || shooter.userId !== shot.shooterId) throw new Error("Joueurs invalides.");
        const resolvingBotAsHost = Boolean(shooter.isBot && await hostId(code) === user.id);
        if (shot.shooterId !== user.id && !resolvingBotAsHost) throw new Error("Seul le tireur peut valider le coup.");
        const before = parseBalls(current.balls); const simulationResult = simulateShot(before, shot); const simulated = simulationResult.balls;
        const previouslyPocketed = new Set(before.filter((ball) => ball.pocketed).map((ball) => ball.id));
        const pocketed = simulationResult.pocketOrder.filter((id) => !previouslyPocketed.has(id));
        const scratch = pocketed.includes(0); const black = pocketed.includes(8);
        const groups = parseGroups(current.groups);
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
        }
        await client.query(`update retro_pool_games set status=$1,turn_index=$2,balls=$3::jsonb,groups=$4::jsonb,shot=null,winner_id=$5,last_message=$6,updated_at=now() where room_code=$7`, [winnerId ? "gameover" : "playing", nextTurn, JSON.stringify(finalBalls), JSON.stringify(groups), winnerId, message, code]);
        await client.query("commit"); return NextResponse.json({ ok: true, game: await state(code) });
      } catch (error) { try { await client.query("rollback"); } catch {} throw error; } finally { client.release(); }
    }

    if (action === "stop") {
      if (await hostId(code) !== user.id) throw new Error("Seul l'hôte peut arrêter le billard.");
      await db().query(`update retro_pool_games set status='lobby',players='[]'::jsonb,turn_index=0,balls=$1::jsonb,groups='{}'::jsonb,shot=null,winner_id=null,last_message=null,updated_at=now() where room_code=$2`, [JSON.stringify(rackBalls()), code]);
      return NextResponse.json({ ok: true, game: await state(code) });
    }
    throw new Error("Action Billard inconnue.");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erreur inconnue.";
    return NextResponse.json({ ok: false, error: message === "AUTH_REQUIRED" ? "Connexion requise." : message }, { status: message === "AUTH_REQUIRED" ? 401 : 400 });
  }
}
