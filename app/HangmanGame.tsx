"use client";

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
