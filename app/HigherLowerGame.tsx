"use client";

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
