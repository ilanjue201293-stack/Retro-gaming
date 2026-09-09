"use client";

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
