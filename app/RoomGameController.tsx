"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import TicTacToeGame from "./TicTacToeGame";
import HigherLowerGame from "./HigherLowerGame";
import HangmanGame from "./HangmanGame";
import FlappyGame from "./FlappyGame";
import { GAME_REGISTRY, GameKey } from "./gameRegistry";

type RoomMember = { id: string; username: string; online: boolean; joined_at: string };
type RoomState = { code: string; hostId: string; currentGame: GameKey; members: RoomMember[]; userId: string; gameControlSeq?: number; gameControlAction?: string | null; gameControlGame?: string | null };
const ROOM_KEY = "retro-active-room";
const LOCAL_GAMES: GameKey[] = ["higherlower", "flappy"];

async function post(path: string, payload: Record<string, unknown>) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 5500);
  try {
    const response = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload), cache: "no-store", signal: controller.signal });
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.error || "Action impossible.");
    return data;
  } finally { window.clearTimeout(timeout); }
}

export default function RoomGameController() {
  const [room, setRoom] = useState<RoomState | null>(null);
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const [bodyTarget, setBodyTarget] = useState<HTMLElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const lastControlSeq = useRef<number | null>(null);

  const refresh = useCallback(async () => {
    const code = window.localStorage.getItem(ROOM_KEY);
    if (!code) { setRoom(null); return; }
    try {
      const data = await post("/api/game-room", { action: "state", code });
      const next = data.room as RoomState;
      const seq = Number(next.gameControlSeq || 0);
      if (lastControlSeq.current === null) lastControlSeq.current = seq;
      else if (seq > lastControlSeq.current) {
        lastControlSeq.current = seq;
        if (next.gameControlGame === next.currentGame && ["replay", "lobby", "end"].includes(next.gameControlAction || "")) {
          window.dispatchEvent(new CustomEvent("retro:local-game-control", { detail: next.gameControlAction }));
        }
      }
      setRoom(next);
      window.dispatchEvent(new CustomEvent("retro:room-state", { detail: next }));
      setError("");
    } catch {}
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
    if (LOCAL_GAMES.includes(room.currentGame)) {
      setBusy(true);
      try {
        const data = await post("/api/game-room", { action: "localControl", code: room.code, control: "lobby" });
        const next = data.room as RoomState; lastControlSeq.current = Number(next.gameControlSeq || 0); setRoom(next);
        window.dispatchEvent(new CustomEvent("retro:local-game-control", { detail: "lobby" }));
        setToast(`${label} · tout le monde est revenu au lobby`);
      } catch (err) { setError(err instanceof Error ? err.message : "Impossible d'arrêter la partie."); } finally { setBusy(false); }
      return;
    }
    setBusy(true); setError("");
    try {
      if (room.currentGame === "hockey") await post("/api/rooms", { action: "hockeyStop", code: room.code });
      else if (room.currentGame === "pong") await post("/api/pong", { action: "stop", code: room.code });
      else if (room.currentGame === "rps") await post("/api/rps", { action: "stop", code: room.code });
      else if (room.currentGame === "dunkshot") await post("/api/dunkshot", { action: "stop", code: room.code });
      else if (room.currentGame === "pool") await post("/api/pool", { action: "stop", code: room.code });
      else if (room.currentGame === "tictactoe") await post("/api/game-room", { action: "tttReset", code: room.code });
      else if (room.currentGame === "hangman") await post("/api/hangman", { action: "stop", code: room.code });
      setToast(`${label} · tout le monde est revenu au lobby`);
    } catch (err) { setError(err instanceof Error ? err.message : "Impossible d'arrêter la partie."); }
    finally { setBusy(false); }
  }

  async function replay() {
    if (!room || room.hostId !== room.userId) return;
    if (LOCAL_GAMES.includes(room.currentGame)) {
      try {
        const data = await post("/api/game-room", { action: "localControl", code: room.code, control: "replay" });
        const next = data.room as RoomState; lastControlSeq.current = Number(next.gameControlSeq || 0); setRoom(next);
        window.dispatchEvent(new CustomEvent("retro:local-game-control", { detail: "replay" })); setToast("Nouvelle partie");
      } catch (err) { setError(err instanceof Error ? err.message : "Impossible de rejouer."); }
      return;
    }
    const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>(".roomMain button, .hockeyFocusStage button"));
    const replayButton = buttons.find((button) => /rejouer|nouvelle partie/i.test(button.textContent || "") && !button.disabled);
    if (replayButton) { replayButton.click(); setToast("Nouvelle partie"); }
    else setToast("Rejouer sera actif dès la fin de la partie.");
  }

  async function endGame() {
    if (!room || room.hostId !== room.userId) return;
    if (LOCAL_GAMES.includes(room.currentGame)) {
      try {
        const data = await post("/api/game-room", { action: "localControl", code: room.code, control: "end" });
        const next = data.room as RoomState; lastControlSeq.current = Number(next.gameControlSeq || 0); setRoom(next);
        window.dispatchEvent(new CustomEvent("retro:local-game-control", { detail: "end" })); setToast("Partie terminée");
      } catch (err) { setError(err instanceof Error ? err.message : "Impossible de terminer la partie."); }
      return;
    }
    void sendToLobby("Fin de partie");
  }

  if (!room) return null;
  const isHost = room.hostId === room.userId;
  const selected = GAME_REGISTRY.find((game) => game.key === room.currentGame) ?? GAME_REGISTRY[0];
  const portalGame = target ? createPortal(<>
    {room.currentGame === "tictactoe" && <div data-room-game-ui="true" className="roomGamePortal"><TicTacToeGame room={room}/></div>}
    {room.currentGame === "higherlower" && <div data-room-game-ui="true" className="roomGamePortal"><HigherLowerGame/></div>}
    {room.currentGame === "hangman" && <div data-room-game-ui="true" className="roomGamePortal"><HangmanGame room={room}/></div>}
    {room.currentGame === "flappy" && <div data-room-game-ui="true" className="roomGamePortal"><FlappyGame/></div>}
    <section data-room-game-ui="true" className="gameSwitcherPanel">
      <div className="gameSwitcherCopy"><span className="kicker">JEU DE LA ROOM</span><strong>{selected.icon} {selected.label}</strong><small>{isHost ? "Changer ici change le jeu pour toute la room." : "Seul l'hôte peut changer de jeu."}</small></div>
      <label className="gameSwitcherSelect"><span>Changer de jeu</span><select value={room.currentGame} disabled={!isHost || busy} onChange={(event) => void changeGame(event.target.value as GameKey)}>{GAME_REGISTRY.map((game) => <option key={game.key} value={game.key}>{game.icon} {game.label}</option>)}</select></label>
      {error && <div className="gameSwitcherError">{error}</div>}
    </section>
  </>, target) : null;

  const hostControls = bodyTarget && isHost ? createPortal(<><div className="hostGameControlsFloating"><button className="end" disabled={busy} onClick={() => void endGame()}>■ End game</button><button className="replay" disabled={busy} onClick={() => void replay()}>↻ Rejouer</button><button disabled={busy} onClick={() => void sendToLobby()}>← Lobby du jeu</button></div>{toast && <div className="globalGameToast">{toast}</div>}</>, bodyTarget) : null;
  return <>{portalGame}{hostControls}</>;
}
