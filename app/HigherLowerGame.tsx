"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

type Status = "lobby" | "playing" | "gameover";
type Mode = "solo" | "bot";
type GuessEntry = { by: "toi" | "bot"; value: number };

function randomTarget() { return 1 + Math.floor(Math.random() * 100); }
function randomBetween(min: number, max: number) { return min + Math.floor(Math.random() * (max - min + 1)); }

export default function HigherLowerGame() {
  const [status, setStatus] = useState<Status>("lobby");
  const [mode, setMode] = useState<Mode>("solo");
  const [target, setTarget] = useState(randomTarget);
  const [guess, setGuess] = useState("");
  const [attempts, setAttempts] = useState(0);
  const [hint, setHint] = useState("Je pense à un nombre entre 1 et 100.");
  const [history, setHistory] = useState<GuessEntry[]>([]);
  const [botTurn, setBotTurn] = useState(false);

  const range = useMemo(() => {
    let min = 1, max = 100;
    for (const entry of history) {
      if (entry.value < target) min = Math.max(min, entry.value + 1);
      if (entry.value > target) max = Math.min(max, entry.value - 1);
    }
    return { min, max };
  }, [history, target]);

  const start = (nextMode: Mode = mode) => {
    setMode(nextMode); setTarget(randomTarget()); setGuess(""); setAttempts(0); setHistory([]); setBotTurn(false);
    setHint(nextMode === "bot" ? "Trouve le nombre avant le BOT." : "Je pense à un nombre entre 1 et 100.");
    setStatus("playing");
  };
  const lobby = () => { setStatus("lobby"); setGuess(""); setHistory([]); setBotTurn(false); };
  const end = () => { if (status === "playing") { setHint(`Partie terminée · le nombre était ${target}.`); setStatus("gameover"); setBotTurn(false); } };

  useEffect(() => {
    const handler = (event: Event) => {
      const action = (event as CustomEvent<string>).detail;
      if (action === "replay") start(mode);
      else if (action === "lobby") lobby();
      else if (action === "end") end();
    };
    window.addEventListener("retro:local-game-control", handler as EventListener);
    return () => window.removeEventListener("retro:local-game-control", handler as EventListener);
  }, [status, target, mode]);

  useEffect(() => {
    if (!botTurn || mode !== "bot" || status !== "playing") return;
    const timer = window.setTimeout(() => {
      const value = randomBetween(range.min, range.max);
      setHistory((current) => [{ by: "bot", value }, ...current].slice(0, 12));
      if (value === target) {
        setHint(`Le BOT a trouvé ${target} avant toi !`);
        setStatus("gameover");
      } else {
        setHint(value < target ? `BOT : ${value} → c'est PLUS ↑` : `BOT : ${value} → c'est MOINS ↓`);
      }
      setBotTurn(false);
    }, 520);
    return () => window.clearTimeout(timer);
  }, [botTurn, mode, range.min, range.max, status, target]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (status !== "playing" || botTurn) return;
    const value = Math.trunc(Number(guess));
    if (!Number.isFinite(value) || value < range.min || value > range.max) { setHint(`Entre un nombre entre ${range.min} et ${range.max}.`); return; }
    const nextAttempts = attempts + 1;
    setAttempts(nextAttempts); setHistory((current) => [{ by: "toi", value }, ...current].slice(0, 12)); setGuess("");
    if (value === target) {
      setHint(`Trouvé en ${nextAttempts} essai${nextAttempts > 1 ? "s" : ""} !`);
      setStatus("gameover");
    } else {
      setHint(value < target ? "C'EST PLUS ↑" : "C'EST MOINS ↓");
      if (mode === "bot") setBotTurn(true);
    }
  };

  if (status === "lobby") return <section className="miniGameCard miniNumberGame">
    <div className="miniHeroIcon">🔢</div><span className="kicker">LOGIQUE</span><h2>Le Plus ou Moins</h2>
    <p>Le programme choisit un nombre entre 1 et 100. En mode BOT, il choisit au hasard uniquement parmi les nombres encore possibles.</p>
    <div className="numberModeActions"><button className="primaryButton" onClick={() => start("solo")}>Jouer en solo</button><button className="secondaryButton" onClick={() => start("bot")}>🤖 Jouer contre le BOT</button></div>
  </section>;

  return <section className="miniGameCard miniNumberGame">
    <div className="miniGameTop"><div><span className="kicker">PLUS OU MOINS · {mode === "bot" ? "VS BOT" : "SOLO"}</span><h2>Trouve le nombre</h2></div><div className="miniStat"><small>ESSAIS</small><strong>{attempts}</strong></div></div>
    <div className={`numberHint ${status === "gameover" ? "done" : ""}`}>{hint}</div>
    <div className="numberRange"><small>ZONE ENCORE POSSIBLE</small><strong>{range.min} — {range.max}</strong></div>
    {mode === "bot" && <div className={`numberBotPanel ${botTurn ? "thinking" : ""}`}><span>🤖</span><div><small>BOT</small><strong>{botTurn ? "réfléchit…" : "Prêt"}</strong></div><em>Pas de difficulté · choix aléatoire dans la zone restante</em></div>}
    {status === "playing" && <form className="numberGuessForm" onSubmit={submit}><input inputMode="numeric" autoFocus value={guess} disabled={botTurn} onChange={(e) => setGuess(e.target.value.replace(/[^0-9]/g, "").slice(0,3))} placeholder={String(Math.round((range.min + range.max) / 2))}/><button className="primaryButton" disabled={botTurn}>Tester</button></form>}
    {!!history.length && <div className="guessHistory">{history.map((entry, index) => <span className={entry.by === "bot" ? "botGuess" : ""} key={`${entry.by}-${entry.value}-${index}`}>{entry.by === "bot" ? "🤖 " : ""}{entry.value}</span>)}</div>}
    <div className="miniGameActions"><button className="primaryButton" onClick={() => start(mode)}>↻ Rejouer</button><button className="secondaryButton" onClick={lobby}>Lobby du jeu</button></div>
  </section>;
}
