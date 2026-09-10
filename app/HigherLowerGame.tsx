"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";

type Status = "lobby" | "playing" | "gameover";
type Mode = "solo" | "bot";
type GuessEntry = { by: "toi" | "bot"; value: number };

function randomTarget() { return 1 + Math.floor(Math.random() * 100); }
function randomBetween(min: number, max: number) { return min + Math.floor(Math.random() * (Math.max(min, max) - min + 1)); }

export default function HigherLowerGame() {
  const [status, setStatus] = useState<Status>("lobby");
  const [mode, setMode] = useState<Mode>("solo");
  const [target, setTarget] = useState(randomTarget);
  const [guess, setGuess] = useState("");
  const [attempts, setAttempts] = useState(0);
  const [hint, setHint] = useState("Je pense à un nombre entre 1 et 100.");
  const [history, setHistory] = useState<GuessEntry[]>([]);
  const [min, setMin] = useState(1);
  const [max, setMax] = useState(100);
  const [botThinking, setBotThinking] = useState(false);
  const [botLastGuess, setBotLastGuess] = useState<number | null>(null);
  const timerRef = useRef<number | null>(null);

  const clearBotTimer = useCallback(() => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = null;
    setBotThinking(false);
  }, []);

  const start = useCallback((nextMode: Mode = mode) => {
    clearBotTimer();
    setMode(nextMode);
    setTarget(randomTarget());
    setGuess("");
    setAttempts(0);
    setHistory([]);
    setMin(1);
    setMax(100);
    setBotLastGuess(null);
    setHint(nextMode === "bot" ? "Trouve le nombre avant le BOT." : "Je pense à un nombre entre 1 et 100.");
    setStatus("playing");
  }, [clearBotTimer, mode]);

  const lobby = useCallback(() => {
    clearBotTimer();
    setStatus("lobby");
    setGuess("");
    setHistory([]);
    setMin(1);
    setMax(100);
    setBotLastGuess(null);
  }, [clearBotTimer]);

  const end = useCallback(() => {
    clearBotTimer();
    if (status === "playing") {
      setHint(`Partie terminée · le nombre était ${target}.`);
      setStatus("gameover");
    }
  }, [clearBotTimer, status, target]);

  useEffect(() => () => clearBotTimer(), [clearBotTimer]);

  useEffect(() => {
    const handler = (event: Event) => {
      const action = (event as CustomEvent<string>).detail;
      if (action === "replay") start(mode);
      else if (action === "lobby") lobby();
      else if (action === "end") end();
    };
    window.addEventListener("retro:local-game-control", handler as EventListener);
    return () => window.removeEventListener("retro:local-game-control", handler as EventListener);
  }, [end, lobby, mode, start]);

  const updateRange = (value: number, currentMin: number, currentMax: number) => {
    if (value < target) return { min: Math.max(currentMin, value + 1), max: currentMax };
    return { min: currentMin, max: Math.min(currentMax, value - 1) };
  };

  const playBot = (rangeMin: number, rangeMax: number) => {
    setBotThinking(true);
    timerRef.current = window.setTimeout(() => {
      const value = randomBetween(rangeMin, rangeMax);
      setBotLastGuess(value);
      setHistory((current) => [{ by: "bot", value }, ...current].slice(0, 12));
      if (value === target) {
        setHint(`Le BOT a trouvé ${target} avant toi !`);
        setStatus("gameover");
        setBotThinking(false);
        timerRef.current = null;
        return;
      }
      const next = updateRange(value, rangeMin, rangeMax);
      setMin(next.min);
      setMax(next.max);
      setHint(value < target ? `BOT : ${value} → c'est PLUS ↑` : `BOT : ${value} → c'est MOINS ↓`);
      setBotThinking(false);
      timerRef.current = null;
    }, 520);
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (status !== "playing" || botThinking) return;
    const value = Math.trunc(Number(guess));
    if (!Number.isFinite(value) || value < min || value > max) {
      setHint(`Entre un nombre entre ${min} et ${max}.`);
      return;
    }

    const nextAttempts = attempts + 1;
    setAttempts(nextAttempts);
    setHistory((current) => [{ by: "toi", value }, ...current].slice(0, 12));
    setGuess("");

    if (value === target) {
      clearBotTimer();
      setHint(`Trouvé en ${nextAttempts} essai${nextAttempts > 1 ? "s" : ""} !`);
      setStatus("gameover");
      return;
    }

    const next = updateRange(value, min, max);
    setMin(next.min);
    setMax(next.max);
    setHint(value < target ? "C'EST PLUS ↑" : "C'EST MOINS ↓");
    if (mode === "bot") playBot(next.min, next.max);
  };

  if (status === "lobby") return <section className="miniGameCard miniNumberGame">
    <div className="miniHeroIcon">🔢</div>
    <span className="kicker">LOGIQUE</span>
    <h2>Le Plus ou Moins</h2>
    <p>Le programme choisit un nombre entre 1 et 100. Joue seul ou trouve-le avant un bot qui choisit au hasard uniquement dans la zone encore possible.</p>
    <div className="numberModeActions">
      <button className="primaryButton" onClick={() => start("solo")}>Jouer en solo</button>
      <button className="secondaryButton" onClick={() => start("bot")}>🤖 Jouer contre le BOT</button>
    </div>
  </section>;

  return <section className="miniGameCard miniNumberGame">
    <div className="miniGameTop">
      <div><span className="kicker">PLUS OU MOINS · {mode === "bot" ? "VS BOT" : "SOLO"}</span><h2>Trouve le nombre</h2></div>
      <div className="miniStat"><small>ESSAIS</small><strong>{attempts}</strong></div>
    </div>
    <div className={`numberHint ${status === "gameover" ? "done" : ""}`}>{hint}</div>
    <div className="numberRange"><small>ZONE ENCORE POSSIBLE</small><strong>{min} — {max}</strong></div>
    {mode === "bot" && <div className={`numberBotPanel ${botThinking ? "thinking" : ""}`}>
      <span>🤖</span>
      <div><small>BOT</small><strong>{botThinking ? "réfléchit…" : botLastGuess === null ? "Prêt" : `Dernier choix : ${botLastGuess}`}</strong></div>
      <em>Pas de difficulté · choix aléatoire entre {min} et {max}</em>
    </div>}
    {status === "playing" && <form className="numberGuessForm" onSubmit={submit}>
      <input inputMode="numeric" autoFocus value={guess} disabled={botThinking} onChange={(e) => setGuess(e.target.value.replace(/[^0-9]/g, "").slice(0,3))} placeholder={String(Math.round((min + max) / 2))}/>
      <button className="primaryButton" disabled={botThinking}>Tester</button>
    </form>}
    {!!history.length && <div className="guessHistory">{history.map((entry, index) => <span className={entry.by === "bot" ? "botGuess" : ""} key={`${entry.by}-${entry.value}-${index}`}>{entry.by === "bot" ? "🤖 " : ""}{entry.value}</span>)}</div>}
    <div className="miniGameActions"><button className="primaryButton" onClick={() => start(mode)}>↻ Rejouer</button><button className="secondaryButton" onClick={lobby}>Lobby du jeu</button></div>
  </section>;
}
