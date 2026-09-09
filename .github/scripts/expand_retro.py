from pathlib import Path

ROOT = Path('.')

def write(path: str, content: str):
    p = ROOT / path
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(content, encoding='utf-8')

def replace_once(path: str, old: str, new: str):
    p = ROOT / path
    text = p.read_text(encoding='utf-8')
    if old not in text:
        raise SystemExit(f'Missing expected text in {path}: {old[:120]!r}')
    p.write_text(text.replace(old, new, 1), encoding='utf-8')

# Central UI registry: every new game should be added here once so the room switcher
# and dashboard library stay in sync.
write('app/gameRegistry.ts', '''export const GAME_REGISTRY = [
  { key: "hockey", label: "Hockey Arcade", icon: "🏒", meta: "ARCADE · MULTI", description: "Hockey temps réel avec 1v1, 2v1, 2v2 et bots." },
  { key: "pong", label: "Pong", icon: "▮●▮", meta: "ARCADE · 2 JOUEURS", description: "Le classique Pong en duel, avec bots et réglages de score." },
  { key: "rps", label: "Pierre · Feuille · Ciseaux", icon: "✊", meta: "DUEL · 2 JOUEURS", description: "Choisis en secret puis découvre le résultat après le décompte." },
  { key: "dunkshot", label: "Dunkshot", icon: "🏀", meta: "ARCADE · SOLO / 1V1", description: "Dose l'angle et la puissance pour enchaîner les paniers." },
  { key: "pool", label: "Billard", icon: "🎱", meta: "8-BALL · SOLO / 1V1", description: "Billard physique avec pleines, rayées, bots et vraie visée." },
  { key: "tictactoe", label: "Morpion (Tic-Tac-Toe)", icon: "❌⭕", meta: "CLASSIQUE · 2 JOUEURS", description: "Aligne trois symboles avant ton adversaire, ou joue contre un bot." },
  { key: "higherlower", label: "Le Plus ou Moins", icon: "🔢", meta: "LOGIQUE · SOLO", description: "Le programme choisit un nombre : trouve-le grâce aux indices plus ou moins." },
  { key: "hangman", label: "Le Pendu", icon: "📝", meta: "MOTS · SOLO", description: "Retrouve le mot secret lettre par lettre avant d'épuiser tes essais." },
  { key: "flappy", label: "Flappy", icon: "🐤", meta: "ARCADE · SOLO", description: "Saute au bon moment et traverse un maximum de tuyaux sans collision." },
] as const;

export type GameKey = (typeof GAME_REGISTRY)[number]["key"];
export const BASE_LIBRARY_KEYS: GameKey[] = ["hockey", "pong", "rps", "dunkshot"];
''')

write('app/HigherLowerGame.tsx', '''"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

type Status = "lobby" | "playing" | "gameover";

function randomTarget() { return 1 + Math.floor(Math.random() * 100); }

export default function HigherLowerGame() {
  const [status, setStatus] = useState<Status>("lobby");
  const [target, setTarget] = useState(randomTarget);
  const [guess, setGuess] = useState("");
  const [attempts, setAttempts] = useState(0);
  const [hint, setHint] = useState("Je pense à un nombre entre 1 et 100.");
  const [history, setHistory] = useState<number[]>([]);

  const start = () => { setTarget(randomTarget()); setGuess(""); setAttempts(0); setHistory([]); setHint("Je pense à un nombre entre 1 et 100."); setStatus("playing"); };
  const lobby = () => { setStatus("lobby"); setGuess(""); setHistory([]); };
  const end = () => { if (status === "playing") { setHint(`Partie terminée · le nombre était ${target}.`); setStatus("gameover"); } };

  useEffect(() => {
    const handler = (event: Event) => {
      const action = (event as CustomEvent<string>).detail;
      if (action === "replay") start();
      else if (action === "lobby") lobby();
      else if (action === "end") end();
    };
    window.addEventListener("retro:local-game-control", handler as EventListener);
    return () => window.removeEventListener("retro:local-game-control", handler as EventListener);
  }, [status, target]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (status !== "playing") return;
    const value = Math.trunc(Number(guess));
    if (!Number.isFinite(value) || value < 1 || value > 100) { setHint("Entre un nombre entre 1 et 100."); return; }
    const nextAttempts = attempts + 1;
    setAttempts(nextAttempts); setHistory((current) => [value, ...current].slice(0, 8)); setGuess("");
    if (value === target) { setHint(`Trouvé en ${nextAttempts} essai${nextAttempts > 1 ? "s" : ""} !`); setStatus("gameover"); }
    else setHint(value < target ? "C'EST PLUS ↑" : "C'EST MOINS ↓");
  };

  const range = useMemo(() => {
    let min = 1, max = 100;
    for (const value of history) { if (value < target) min = Math.max(min, value + 1); if (value > target) max = Math.min(max, value - 1); }
    return `${min} — ${max}`;
  }, [history, target]);

  if (status === "lobby") return <section className="miniGameCard miniNumberGame"><div className="miniHeroIcon">🔢</div><span className="kicker">LOGIQUE · SOLO</span><h2>Le Plus ou Moins</h2><p>Le programme choisit un nombre entre 1 et 100. Devine-le avec les indices « plus » ou « moins ».</p><button className="primaryButton" onClick={start}>Commencer</button></section>;

  return <section className="miniGameCard miniNumberGame">
    <div className="miniGameTop"><div><span className="kicker">PLUS OU MOINS</span><h2>Trouve le nombre</h2></div><div className="miniStat"><small>ESSAIS</small><strong>{attempts}</strong></div></div>
    <div className={`numberHint ${status === "gameover" ? "done" : ""}`}>{hint}</div>
    <div className="numberRange"><small>ZONE PROBABLE</small><strong>{range}</strong></div>
    {status === "playing" && <form className="numberGuessForm" onSubmit={submit}><input inputMode="numeric" autoFocus value={guess} onChange={(e) => setGuess(e.target.value.replace(/[^0-9]/g, "").slice(0,3))} placeholder="50"/><button className="primaryButton">Tester</button></form>}
    {!!history.length && <div className="guessHistory">{history.map((value, index) => <span key={`${value}-${index}`}>{value}</span>)}</div>}
    <div className="miniGameActions"><button className="primaryButton" onClick={start}>↻ Rejouer</button><button className="secondaryButton" onClick={lobby}>Lobby du jeu</button></div>
  </section>;
}
''')

write('app/HangmanGame.tsx', '''"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

const WORDS = ["ARCADE","MANETTE","PIXEL","ROBOT","BILLARD","HOCKEY","PLANETE","MUSIQUE","DRAGON","CIRCUIT","FUSEE","OCEAN","CAMERA","GALAXIE","BASKET","FORTERESSE","TROPHEE","AVENTURE","MYSTERE","ORDINATEUR"];
const MAX_ERRORS = 7;
type Status = "lobby" | "playing" | "gameover";
function pickWord() { return WORDS[Math.floor(Math.random() * WORDS.length)]; }

export default function HangmanGame() {
  const [status, setStatus] = useState<Status>("lobby");
  const [word, setWord] = useState(pickWord);
  const [letters, setLetters] = useState<string[]>([]);
  const [entry, setEntry] = useState("");
  const guessed = useMemo(() => new Set(letters), [letters]);
  const errors = letters.filter((letter) => !word.includes(letter)).length;
  const won = word.split("").every((letter) => guessed.has(letter));

  const start = () => { setWord(pickWord()); setLetters([]); setEntry(""); setStatus("playing"); };
  const lobby = () => { setStatus("lobby"); setLetters([]); setEntry(""); };
  const end = () => setStatus("gameover");

  useEffect(() => {
    if (status === "playing" && (won || errors >= MAX_ERRORS)) setStatus("gameover");
  }, [won, errors, status]);
  useEffect(() => {
    const handler = (event: Event) => {
      const action = (event as CustomEvent<string>).detail;
      if (action === "replay") start(); else if (action === "lobby") lobby(); else if (action === "end") end();
    };
    window.addEventListener("retro:local-game-control", handler as EventListener);
    return () => window.removeEventListener("retro:local-game-control", handler as EventListener);
  }, []);

  const playLetter = (raw: string) => {
    if (status !== "playing") return;
    const letter = raw.toUpperCase().replace(/[^A-Z]/g, "").slice(0,1);
    if (!letter || guessed.has(letter)) return;
    setLetters((current) => [...current, letter]);
  };
  const submit = (event: FormEvent) => { event.preventDefault(); playLetter(entry); setEntry(""); };

  if (status === "lobby") return <section className="miniGameCard hangmanGame"><div className="miniHeroIcon">📝</div><span className="kicker">MOTS · SOLO</span><h2>Le Pendu</h2><p>Le programme choisit un mot. Retrouve-le avant d'atteindre {MAX_ERRORS} erreurs.</p><button className="primaryButton" onClick={start}>Commencer</button></section>;

  const display = word.split("").map((letter) => guessed.has(letter) || status === "gameover" ? letter : "_").join(" ");
  const result = status === "gameover" ? (won ? "Mot trouvé !" : `Le mot était ${word}`) : `${MAX_ERRORS - errors} erreur${MAX_ERRORS - errors > 1 ? "s" : ""} restante${MAX_ERRORS - errors > 1 ? "s" : ""}`;

  return <section className="miniGameCard hangmanGame">
    <div className="miniGameTop"><div><span className="kicker">LE PENDU</span><h2>{result}</h2></div><div className="miniStat"><small>ERREURS</small><strong>{errors}/{MAX_ERRORS}</strong></div></div>
    <div className="hangmanStage"><div className={`hangmanFigure errors-${errors}`}><i className="rope"/><i className="head"/><i className="body"/><i className="arm left"/><i className="arm right"/><i className="leg left"/><i className="leg right"/></div><div className="hangmanWord">{display}</div></div>
    {status === "playing" && <><form className="hangmanInput" onSubmit={submit}><input autoFocus maxLength={1} value={entry} onChange={(e) => setEntry(e.target.value)} placeholder="A"/><button className="primaryButton">Proposer</button></form><div className="letterGrid">{"ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").map((letter) => <button key={letter} disabled={guessed.has(letter)} onClick={() => playLetter(letter)}>{letter}</button>)}</div></>}
    <div className="miniGameActions"><button className="primaryButton" onClick={start}>↻ Rejouer</button><button className="secondaryButton" onClick={lobby}>Lobby du jeu</button></div>
  </section>;
}
''')

write('app/FlappyGame.tsx', '''"use client";

import { PointerEvent, useCallback, useEffect, useRef, useState } from "react";

type Status = "lobby" | "playing" | "gameover";
type Pipe = { x: number; gap: number; passed: boolean };

export default function FlappyGame() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef(0);
  const birdY = useRef(0.5);
  const velocity = useRef(0);
  const pipes = useRef<Pipe[]>([]);
  const last = useRef(0);
  const [status, setStatus] = useState<Status>("lobby");
  const [score, setScore] = useState(0);
  const [best, setBest] = useState(0);

  const resetWorld = useCallback(() => {
    birdY.current = 0.5; velocity.current = 0; last.current = performance.now();
    pipes.current = [{ x: 1.05, gap: 0.43, passed: false }, { x: 1.62, gap: 0.58, passed: false }, { x: 2.19, gap: 0.36, passed: false }];
    setScore(0);
  }, []);
  const start = useCallback(() => { resetWorld(); setStatus("playing"); }, [resetWorld]);
  const lobby = useCallback(() => { cancelAnimationFrame(rafRef.current); resetWorld(); setStatus("lobby"); }, [resetWorld]);
  const finish = useCallback(() => { setStatus("gameover"); setBest((current) => Math.max(current, score)); }, [score]);
  const jump = useCallback(() => { if (status === "lobby" || status === "gameover") { start(); velocity.current = -0.62; } else velocity.current = -0.62; }, [status, start]);

  useEffect(() => {
    const handler = (event: Event) => {
      const action = (event as CustomEvent<string>).detail;
      if (action === "replay") start(); else if (action === "lobby") lobby(); else if (action === "end") finish();
    };
    window.addEventListener("retro:local-game-control", handler as EventListener);
    return () => window.removeEventListener("retro:local-game-control", handler as EventListener);
  }, [start, lobby, finish]);

  useEffect(() => {
    const key = (event: KeyboardEvent) => { if (event.code === "Space") { event.preventDefault(); jump(); } };
    window.addEventListener("keydown", key, { passive: false });
    return () => window.removeEventListener("keydown", key);
  }, [jump]);

  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const ctx = canvas.getContext("2d"); if (!ctx) return;
    let alive = true;

    const draw = (now: number) => {
      if (!alive) return;
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const width = Math.max(320, Math.round(rect.width * dpr));
      const height = Math.max(180, Math.round(rect.height * dpr));
      if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const w = width / dpr, h = height / dpr;
      const dt = Math.min(0.034, Math.max(0.001, (now - (last.current || now)) / 1000)); last.current = now;

      if (status === "playing") {
        velocity.current += 1.72 * dt;
        birdY.current += velocity.current * dt;
        for (const pipe of pipes.current) pipe.x -= 0.35 * dt;
        for (const pipe of pipes.current) {
          if (!pipe.passed && pipe.x < 0.22) { pipe.passed = true; setScore((value) => value + 1); }
          if (pipe.x < -0.14) { const maxX = Math.max(...pipes.current.map((p) => p.x)); pipe.x = maxX + 0.57; pipe.gap = 0.27 + Math.random() * 0.46; pipe.passed = false; }
        }
        const birdR = 0.034, pipeW = 0.105, gapSize = 0.29;
        const hitPipe = pipes.current.some((pipe) => Math.abs(pipe.x - 0.22) < pipeW / 2 + birdR && (birdY.current < pipe.gap - gapSize / 2 + birdR || birdY.current > pipe.gap + gapSize / 2 - birdR));
        if (birdY.current < birdR || birdY.current > 1 - birdR || hitPipe) { setBest((value) => Math.max(value, score)); setStatus("gameover"); }
      }

      const sky = ctx.createLinearGradient(0,0,0,h); sky.addColorStop(0,"#61c9ff"); sky.addColorStop(1,"#d9f6ff"); ctx.fillStyle = sky; ctx.fillRect(0,0,w,h);
      ctx.fillStyle = "rgba(255,255,255,.75)"; for (let i=0;i<5;i++){ const x=((i*173 + now*0.012)% (w+120))-60; const y=35+(i%3)*55; ctx.beginPath(); ctx.ellipse(x,y,38,13,0,0,Math.PI*2); ctx.fill(); }
      const pipeWpx = w*0.105, gapPx = h*0.29;
      for (const pipe of pipes.current) { const x=pipe.x*w-pipeWpx/2, gapY=pipe.gap*h; ctx.fillStyle="#33b75f"; ctx.strokeStyle="#166a34"; ctx.lineWidth=3; ctx.fillRect(x,0,pipeWpx,gapY-gapPx/2); ctx.strokeRect(x,0,pipeWpx,gapY-gapPx/2); ctx.fillRect(x,gapY+gapPx/2,pipeWpx,h-(gapY+gapPx/2)); ctx.strokeRect(x,gapY+gapPx/2,pipeWpx,h-(gapY+gapPx/2)); }
      const bx=.22*w, by=birdY.current*h; ctx.save(); ctx.translate(bx,by); ctx.rotate(Math.max(-.45,Math.min(.75,velocity.current*.75))); ctx.fillStyle="#ffd84a"; ctx.beginPath(); ctx.ellipse(0,0,w*.035,h*.035,0,0,Math.PI*2); ctx.fill(); ctx.fillStyle="#ff8d24"; ctx.beginPath(); ctx.moveTo(w*.025,0); ctx.lineTo(w*.055,h*.007); ctx.lineTo(w*.025,h*.017); ctx.closePath(); ctx.fill(); ctx.fillStyle="#fff"; ctx.beginPath(); ctx.arc(w*.014,-h*.011,Math.max(4,w*.007),0,Math.PI*2); ctx.fill(); ctx.fillStyle="#111"; ctx.beginPath(); ctx.arc(w*.017,-h*.011,Math.max(2,w*.003),0,Math.PI*2); ctx.fill(); ctx.restore();
      ctx.fillStyle="rgba(4,11,18,.72)"; ctx.font=`900 ${Math.max(22,w*.045)}px system-ui`; ctx.textAlign="center"; ctx.fillText(String(score),w/2,48);
      if (status !== "playing") { ctx.fillStyle="rgba(5,12,19,.52)"; ctx.fillRect(0,0,w,h); ctx.fillStyle="#fff"; ctx.font=`900 ${Math.max(22,w*.04)}px system-ui`; ctx.fillText(status === "lobby" ? "FLAPPY" : "PERDU !",w/2,h*.42); ctx.font=`700 ${Math.max(12,w*.018)}px system-ui`; ctx.fillText(status === "lobby" ? "Clique / touche / ESPACE pour sauter" : "Clique pour rejouer",w/2,h*.52); }
      rafRef.current = requestAnimationFrame(draw);
    };
    rafRef.current = requestAnimationFrame(draw);
    return () => { alive = false; cancelAnimationFrame(rafRef.current); };
  }, [status, score]);

  const pointer = (event: PointerEvent<HTMLCanvasElement>) => { event.preventDefault(); jump(); };
  return <section className="miniGameCard flappyGame"><div className="miniGameTop"><div><span className="kicker">ARCADE · SOLO</span><h2>Flappy</h2></div><div className="flappyStats"><span><small>SCORE</small><strong>{score}</strong></span><span><small>RECORD</small><strong>{best}</strong></span></div></div><canvas ref={canvasRef} className="flappyCanvas" onPointerDown={pointer}/><div className="miniGameActions"><button className="primaryButton" onClick={start}>↻ Rejouer</button><button className="secondaryButton" onClick={lobby}>Lobby du jeu</button></div></section>;
}
''')

write('app/mini-games.css', '''
/* Shared mini-game / host controls */
.miniGameCard{margin-top:16px;border:1px solid #26323e;background:linear-gradient(145deg,#0f161e,#0b1016);border-radius:20px;padding:20px;box-shadow:var(--shadow);min-height:330px;animation:miniEnter .18s ease-out}.miniGameCard h2{font-size:30px;margin:5px 0 8px;letter-spacing:-.04em}.miniGameCard>p{color:var(--muted);font-size:12px;line-height:1.6;max-width:700px}.miniHeroIcon{width:74px;height:74px;display:grid;place-items:center;border-radius:20px;background:#131e29;border:1px solid #2b4052;font-size:38px;margin-bottom:14px}.miniGameTop{display:flex;align-items:center;justify-content:space-between;gap:15px;margin-bottom:16px}.miniStat{border:1px solid #293744;background:#0b1117;border-radius:14px;padding:9px 14px;display:grid;text-align:center}.miniStat small{font-size:8px;color:var(--muted);letter-spacing:.12em;font-weight:900}.miniStat strong{font-size:24px}.miniGameActions{display:flex;gap:8px;margin-top:18px;flex-wrap:wrap}.numberHint{padding:18px;border-radius:15px;border:1px solid #294153;background:rgba(74,164,227,.08);font-size:24px;font-weight:950;text-align:center;letter-spacing:.04em}.numberHint.done{border-color:rgba(143,240,189,.38);background:rgba(143,240,189,.08)}.numberRange{display:grid;text-align:center;margin:18px 0 10px}.numberRange small{font-size:8px;color:var(--muted);font-weight:900;letter-spacing:.12em}.numberRange strong{font-size:19px}.numberGuessForm{display:flex;gap:8px;justify-content:center}.numberGuessForm input{width:140px;text-align:center;font-size:28px;font-weight:950}.guessHistory{display:flex;gap:6px;justify-content:center;flex-wrap:wrap;margin-top:12px}.guessHistory span{border:1px solid #2a3947;background:#111922;border-radius:999px;padding:5px 9px;font-size:10px}.hangmanStage{display:grid;grid-template-columns:160px 1fr;gap:24px;align-items:center;border:1px solid #263643;background:#0a1016;border-radius:18px;padding:18px}.hangmanFigure{height:170px;position:relative;border-left:4px solid #576c7b;border-top:4px solid #576c7b;margin-left:25px}.hangmanFigure:after{content:"";position:absolute;left:-25px;bottom:0;width:100px;height:4px;background:#576c7b}.hangmanFigure i{position:absolute;opacity:.12;transition:opacity .18s}.hangmanFigure .rope{top:0;right:22px;width:3px;height:28px;background:#899aa7}.hangmanFigure .head{top:26px;right:6px;width:34px;height:34px;border:3px solid #e9edf0;border-radius:50%}.hangmanFigure .body{top:61px;right:21px;width:3px;height:52px;background:#e9edf0}.hangmanFigure .arm,.hangmanFigure .leg{width:3px;height:43px;background:#e9edf0;transform-origin:top}.hangmanFigure .arm{top:68px;right:21px}.hangmanFigure .arm.left{transform:rotate(50deg)}.hangmanFigure .arm.right{transform:rotate(-50deg)}.hangmanFigure .leg{top:111px;right:21px}.hangmanFigure .leg.left{transform:rotate(40deg)}.hangmanFigure .leg.right{transform:rotate(-40deg)}.hangmanFigure.errors-1 .rope,.hangmanFigure.errors-2 .rope,.hangmanFigure.errors-2 .head,.hangmanFigure.errors-3 .rope,.hangmanFigure.errors-3 .head,.hangmanFigure.errors-3 .body,.hangmanFigure.errors-4 .rope,.hangmanFigure.errors-4 .head,.hangmanFigure.errors-4 .body,.hangmanFigure.errors-4 .arm.left,.hangmanFigure.errors-5 i:not(.leg),.hangmanFigure.errors-6 i:not(.leg.right),.hangmanFigure.errors-7 i{opacity:1}.hangmanWord{font-size:clamp(22px,4vw,42px);font-weight:950;letter-spacing:.16em;text-align:center;word-break:break-word}.hangmanInput{display:flex;gap:8px;justify-content:center;margin-top:14px}.hangmanInput input{width:80px;text-align:center;font-size:26px;font-weight:950;text-transform:uppercase}.letterGrid{display:grid;grid-template-columns:repeat(13,1fr);gap:5px;margin-top:12px}.letterGrid button{height:34px;border-radius:8px;border:1px solid #2b3946;background:#111922;color:#e7edf2;font-weight:900}.letterGrid button:disabled{opacity:.25}.flappyCanvas{width:100%;aspect-ratio:16/9;display:block;border-radius:17px;border:1px solid #315268;touch-action:none;cursor:pointer;box-shadow:inset 0 0 30px rgba(0,0,0,.14)}.flappyStats{display:flex;gap:7px}.flappyStats span{display:grid;text-align:center;border:1px solid #293744;background:#0b1117;border-radius:12px;padding:7px 11px}.flappyStats small{font-size:7px;color:var(--muted);font-weight:900;letter-spacing:.1em}.flappyStats strong{font-size:19px}.hostGameControlsFloating{position:fixed;right:16px;bottom:16px;z-index:9999;display:flex;gap:7px;padding:8px;border-radius:14px;border:1px solid rgba(114,140,162,.35);background:rgba(7,12,18,.86);backdrop-filter:blur(12px);box-shadow:0 12px 35px rgba(0,0,0,.38)}.hostGameControlsFloating button{border:1px solid #31404c;background:#131c24;color:#e9f0f4;border-radius:9px;padding:8px 10px;font-size:9px;font-weight:900;white-space:nowrap}.hostGameControlsFloating button:hover{transform:translateY(-1px);border-color:#60819a}.hostGameControlsFloating .end{border-color:rgba(255,109,120,.4);color:#ffafb6}.hostGameControlsFloating .replay{border-color:rgba(143,240,189,.4);color:#aef5cd}.globalGameToast{position:fixed;left:50%;bottom:74px;transform:translateX(-50%);z-index:10000;background:#101820;border:1px solid #344654;border-radius:999px;padding:8px 13px;font-size:10px;font-weight:850;box-shadow:0 10px 30px rgba(0,0,0,.35)}
/* Larger hockey cages: visuals match the enlarged 28–72% physics opening. */
.hockeyRink .goal{top:29%;height:42%}.hockeyRink .goalCrease{top:27%;height:46%}
/* Small global rendering wins */
.gameLibraryCard,.panel,.memberCard{contain:layout paint}.roomMain{min-width:0}.roomGamePortal{animation:miniEnter .16s ease-out}@keyframes miniEnter{from{opacity:.55;transform:translateY(4px)}to{opacity:1;transform:none}}
@media(max-width:700px){.miniGameCard{padding:14px;border-radius:16px}.miniGameTop{align-items:flex-start}.hangmanStage{grid-template-columns:1fr}.hangmanFigure{width:120px;margin:auto}.letterGrid{grid-template-columns:repeat(7,1fr)}.hostGameControlsFloating{left:8px;right:8px;bottom:8px;justify-content:center;overflow:auto}.hostGameControlsFloating button{flex:1}.flappyCanvas{aspect-ratio:4/3}}
''')

# UI registry-backed room controller: no 180ms DOM scanning, and one shared host control bar.
write('app/RoomGameController.tsx', '''"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import TicTacToeGame from "./TicTacToeGame";
import HigherLowerGame from "./HigherLowerGame";
import HangmanGame from "./HangmanGame";
import FlappyGame from "./FlappyGame";
import { GAME_REGISTRY, GameKey } from "./gameRegistry";

type RoomMember = { id: string; username: string; online: boolean; joined_at: string };
type RoomState = { code: string; hostId: string; currentGame: GameKey; members: RoomMember[]; userId: string };
const ROOM_KEY = "retro-active-room";
const LOCAL_GAMES: GameKey[] = ["higherlower", "hangman", "flappy"];

async function post(path: string, payload: Record<string, unknown>) {
  const response = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload), cache: "no-store" });
  const data = await response.json();
  if (!response.ok || !data.ok) throw new Error(data.error || "Action impossible.");
  return data;
}

export default function RoomGameController() {
  const [room, setRoom] = useState<RoomState | null>(null);
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const [bodyTarget, setBodyTarget] = useState<HTMLElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");

  const refresh = useCallback(async () => {
    const code = window.localStorage.getItem(ROOM_KEY);
    if (!code) { setRoom(null); return; }
    try { const data = await post("/api/game-room", { action: "state", code }); setRoom(data.room as RoomState); setError(""); } catch {}
  }, []);

  useEffect(() => { setBodyTarget(document.body); void refresh(); const timer = window.setInterval(() => void refresh(), 1200); return () => window.clearInterval(timer); }, [refresh]);
  useEffect(() => {
    const syncTarget = () => setTarget(document.querySelector<HTMLElement>(".roomMain"));
    syncTarget(); const observer = new MutationObserver(syncTarget); observer.observe(document.body, { childList: true, subtree: true }); return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!room) return;
    document.body.dataset.retroCurrentGame = room.currentGame;
    window.dispatchEvent(new CustomEvent<GameKey>("retro:current-game", { detail: room.currentGame }));
    return () => { delete document.body.dataset.retroCurrentGame; };
  }, [room?.currentGame]);
  useEffect(() => { if (!toast) return; const id = window.setTimeout(() => setToast(""), 2200); return () => window.clearTimeout(id); }, [toast]);

  async function changeGame(game: GameKey) {
    if (!room || room.hostId !== room.userId || busy || game === room.currentGame) return;
    const previous = room; setBusy(true); setError(""); setRoom({ ...room, currentGame: game }); window.dispatchEvent(new Event("retro:return-room"));
    try { const data = await post("/api/game-room", { action: "setGame", code: room.code, game }); setRoom(data.room as RoomState); }
    catch (err) { setRoom(previous); setError(err instanceof Error ? err.message : "Impossible de changer de jeu."); }
    finally { setBusy(false); }
  }

  async function sendToLobby(label = "Lobby du jeu") {
    if (!room || room.hostId !== room.userId || busy) return;
    if (LOCAL_GAMES.includes(room.currentGame)) { window.dispatchEvent(new CustomEvent("retro:local-game-control", { detail: "lobby" })); setToast(`${label} · fait`); return; }
    setBusy(true); setError("");
    try {
      if (room.currentGame === "hockey") await post("/api/rooms", { action: "hockeyStop", code: room.code });
      else if (room.currentGame === "pong") await post("/api/pong", { action: "stop", code: room.code });
      else if (room.currentGame === "rps") await post("/api/rps", { action: "stop", code: room.code });
      else if (room.currentGame === "dunkshot") await post("/api/dunkshot", { action: "stop", code: room.code });
      else if (room.currentGame === "pool") await post("/api/pool", { action: "stop", code: room.code });
      else if (room.currentGame === "tictactoe") await post("/api/game-room", { action: "tttReset", code: room.code });
      setToast(`${label} · tout le monde est revenu au lobby`);
    } catch (err) { setError(err instanceof Error ? err.message : "Impossible d'arrêter la partie."); }
    finally { setBusy(false); }
  }

  function replay() {
    if (!room || room.hostId !== room.userId) return;
    if (LOCAL_GAMES.includes(room.currentGame)) { window.dispatchEvent(new CustomEvent("retro:local-game-control", { detail: "replay" })); setToast("Nouvelle partie"); return; }
    const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>(".roomMain button, .hockeyFocusStage button"));
    const replayButton = buttons.find((button) => /rejouer/i.test(button.textContent || "") && !button.disabled);
    if (replayButton) { replayButton.click(); setToast("Nouvelle partie"); }
    else setToast("Rejouer sera actif dès la fin de la partie.");
  }

  function endGame() {
    if (!room || room.hostId !== room.userId) return;
    if (LOCAL_GAMES.includes(room.currentGame)) { window.dispatchEvent(new CustomEvent("retro:local-game-control", { detail: "end" })); setToast("Partie terminée"); return; }
    void sendToLobby("Fin de partie");
  }

  if (!room) return null;
  const isHost = room.hostId === room.userId;
  const selected = GAME_REGISTRY.find((game) => game.key === room.currentGame) ?? GAME_REGISTRY[0];
  const portalGame = target ? createPortal(<>
    {room.currentGame === "tictactoe" && <div data-room-game-ui="true" className="roomGamePortal"><TicTacToeGame room={room}/></div>}
    {room.currentGame === "higherlower" && <div data-room-game-ui="true" className="roomGamePortal"><HigherLowerGame/></div>}
    {room.currentGame === "hangman" && <div data-room-game-ui="true" className="roomGamePortal"><HangmanGame/></div>}
    {room.currentGame === "flappy" && <div data-room-game-ui="true" className="roomGamePortal"><FlappyGame/></div>}
    <section data-room-game-ui="true" className="gameSwitcherPanel">
      <div className="gameSwitcherCopy"><span className="kicker">JEU DE LA ROOM</span><strong>{selected.icon} {selected.label}</strong><small>{isHost ? "Changer ici change le jeu pour toute la room." : "Seul l'hôte peut changer de jeu."}</small></div>
      <label className="gameSwitcherSelect"><span>Changer de jeu</span><select value={room.currentGame} disabled={!isHost || busy} onChange={(event) => void changeGame(event.target.value as GameKey)}>{GAME_REGISTRY.map((game) => <option key={game.key} value={game.key}>{game.icon} {game.label}</option>)}</select></label>
      {error && <div className="gameSwitcherError">{error}</div>}
    </section>
  </>, target) : null;

  const hostControls = bodyTarget && isHost ? createPortal(<><div className="hostGameControlsFloating"><button className="end" disabled={busy} onClick={endGame}>■ End game</button><button className="replay" disabled={busy} onClick={replay}>↻ Rejouer</button><button disabled={busy} onClick={() => void sendToLobby()}>← Lobby du jeu</button></div>{toast && <div className="globalGameToast">{toast}</div>}</>, bodyTarget) : null;
  return <>{portalGame}{hostControls}</>;
}
''')

write('app/DashboardGameLibraryEnhancer.tsx', '''"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { BASE_LIBRARY_KEYS, GAME_REGISTRY, GameKey } from "./gameRegistry";

const ROOM_KEY = "retro-active-room";
const EXTRA_GAMES = GAME_REGISTRY.filter((game) => !(BASE_LIBRARY_KEYS as readonly string[]).includes(game.key));

function gameFromCard(card: Element): GameKey | null {
  const title = card.querySelector("h3")?.textContent?.toLowerCase() ?? "";
  const direct = GAME_REGISTRY.find((game) => game.label.toLowerCase() === title);
  if (direct) return direct.key;
  if (title.includes("hockey")) return "hockey";
  if (title.includes("pong")) return "pong";
  if (title.includes("pierre") || title.includes("ciseaux")) return "rps";
  if (title.includes("dunkshot")) return "dunkshot";
  if (title.includes("billard")) return "pool";
  if (title.includes("morpion") || title.includes("tic-tac-toe")) return "tictactoe";
  if (title.includes("plus ou moins")) return "higherlower";
  if (title.includes("pendu")) return "hangman";
  if (title.includes("flappy")) return "flappy";
  return null;
}
async function post(path: string, payload: Record<string, unknown>) { const response = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload), cache: "no-store" }); const data = await response.json(); if (!response.ok || !data.ok) throw new Error(data.error || "Impossible de créer la room."); return data; }

export default function DashboardGameLibraryEnhancer() {
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const sync = () => { const library = document.querySelector<HTMLElement>(".gamesPreview"); setTarget((current) => current === library ? current : library); const pill = library?.querySelector<HTMLElement>(".availablePill"); if (pill) pill.textContent = `${GAME_REGISTRY.length} JEUX`; };
    sync(); const observer = new MutationObserver(sync); observer.observe(document.body, { childList: true, subtree: true }); return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const click = async (event: MouseEvent) => {
      const button = (event.target as Element | null)?.closest(".gamesPreview .gameLibraryCard .primaryButton"); if (!button || busy) return;
      const card = button.closest(".gameLibraryCard"); const game = card ? gameFromCard(card) : null; if (!game) return;
      event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation();
      try { setBusy(true); const created = await post("/api/rooms", { action: "create" }); const code = created.room?.code as string | undefined; if (!code) throw new Error("Room invalide."); if (game !== "hockey") await post("/api/game-room", { action: "setGame", code, game }); window.localStorage.setItem(ROOM_KEY, code); window.location.reload(); }
      catch (error) { alert(error instanceof Error ? error.message : "Impossible de créer la room."); setBusy(false); }
    };
    document.addEventListener("click", click, true); return () => document.removeEventListener("click", click, true);
  }, [busy]);
  if (!target) return null;
  return createPortal(<>{EXTRA_GAMES.map((game) => <div className="gameLibraryCard" data-game-library={game.key} key={game.key}><div className="gameLibraryIcon">{game.icon}</div><div><small>{game.meta}</small><h3>{game.label}</h3><p>{game.description}</p></div><button className="primaryButton" disabled={busy}>{busy ? "Création…" : "Créer une room"}</button></div>)}</>, target);
}
''')

# Server-side allowed room games now includes Pool and all three mini-games.
replace_once('lib/game-room.ts', 'export const ROOM_GAMES = ["hockey", "pong", "rps", "dunkshot", "tictactoe"] as const;', 'export const ROOM_GAMES = ["hockey", "pong", "rps", "dunkshot", "pool", "tictactoe", "higherlower", "hangman", "flappy"] as const;')

# Only mount the selected network game. This removes the biggest source of background polling/load.
replace_once('app/RetroApp.tsx', 'type Room = { code: string; hostId: string; members: RoomMember[] };', 'type Room = { code: string; hostId: string; members: RoomMember[] };\ntype RoomGameKey = "hockey" | "pong" | "rps" | "dunkshot" | "pool" | "tictactoe" | "higherlower" | "hangman" | "flappy";')
replace_once('app/RetroApp.tsx', '  const [activeGame, setActiveGame] = useState<"hockey" | "pool" | null>(null);', '  const [activeGame, setActiveGame] = useState<"hockey" | "pool" | null>(null);\n  const [selectedRoomGame, setSelectedRoomGame] = useState<RoomGameKey>("hockey");')
needle = '''  useEffect(() => {
    const onGameActive = (event: Event) => {
      const detail = (event as CustomEvent<string | null>).detail;
      setActiveGame(detail === "hockey" || detail === "pool" ? detail : null);
    };
    window.addEventListener("retro:game-active", onGameActive as EventListener);
    return () => window.removeEventListener("retro:game-active", onGameActive as EventListener);
  }, []);
'''
insert = needle + '''  useEffect(() => {
    const onCurrentGame = (event: Event) => {
      const detail = (event as CustomEvent<RoomGameKey>).detail;
      if (!detail) return;
      setSelectedRoomGame(detail);
      if (detail !== "hockey" && detail !== "pool") setActiveGame(null);
    };
    window.addEventListener("retro:current-game", onCurrentGame as EventListener);
    return () => window.removeEventListener("retro:current-game", onCurrentGame as EventListener);
  }, []);
'''
replace_once('app/RetroApp.tsx', needle, insert)
old_mount = '''            {(!activeGame || activeGame === "hockey") && <HockeyGame room={room} user={user} onActiveChange={setHockeyActive}/>}
            {!activeGame && <PongGame room={room} user={user}/>}
            {!activeGame && <RpsGame room={room} user={user}/>}
            {!activeGame && <DunkshotGame room={room} user={user}/>}
            {(!activeGame || activeGame === "pool") && <PoolGame room={room} user={user}/>}
'''
new_mount = '''            {selectedRoomGame === "hockey" && <HockeyGame room={room} user={user} onActiveChange={setHockeyActive}/>}
            {selectedRoomGame === "pong" && <PongGame room={room} user={user}/>}
            {selectedRoomGame === "rps" && <RpsGame room={room} user={user}/>}
            {selectedRoomGame === "dunkshot" && <DunkshotGame room={room} user={user}/>}
            {selectedRoomGame === "pool" && <PoolGame room={room} user={user}/>}
'''
replace_once('app/RetroApp.tsx', old_mount, new_mount)
# Less background room/social traffic while keeping UI responsive.
replace_once('app/RetroApp.tsx', 'const id = window.setInterval(() => void refreshSocial(), activeGame ? 8000 : 3000);', 'const id = window.setInterval(() => void refreshSocial(), activeGame ? 10000 : 4200);')
replace_once('app/RetroApp.tsx', 'const id = window.setInterval(poll, activeGame ? 2200 : 1000);', 'const id = window.setInterval(poll, activeGame ? 3000 : 1500);')

# Hockey: physically and visually larger goals.
replace_once('app/HockeyGame.tsx', 'const GOAL_MIN = 0.33;\nconst GOAL_MAX = 0.67;', 'const GOAL_MIN = 0.28;\nconst GOAL_MAX = 0.72;')

# Load the new mini-game styles last so goal sizing override is deterministic.
replace_once('app/layout.tsx', 'import "./room-games.css";', 'import "./room-games.css";\nimport "./mini-games.css";')

# README catalogue.
replace_once('README.md', '- Billard : solo ou 1v1 8-ball arcade, bots Facile/Normal/Difficile, collisions, bandes, poches et groupes pleines/rayées', '- Billard : solo ou 1v1 8-ball arcade, bots Facile/Normal/Difficile, collisions, bandes, poches et groupes pleines/rayées\n- Morpion : 1v1 ou bot\n- Le Plus ou Moins : défi solo contre le programme\n- Le Pendu : mots secrets et clavier de lettres\n- Flappy : clone arcade fluide au clic, tactile ou espace')

print('Retro expansion patch applied')
