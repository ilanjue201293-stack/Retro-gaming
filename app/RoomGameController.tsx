"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import TicTacToeGame from "./TicTacToeGame";

type GameKey = "hockey" | "pong" | "rps" | "dunkshot" | "tictactoe";
type RoomMember = { id: string; username: string; online: boolean; joined_at: string };
type RoomState = { code: string; hostId: string; currentGame: GameKey; members: RoomMember[]; userId: string };

const GAMES: { key: GameKey; label: string; icon: string }[] = [
  { key: "hockey", label: "Hockey Arcade", icon: "🏒" },
  { key: "pong", label: "Pong", icon: "▮●▮" },
  { key: "rps", label: "Pierre · Feuille · Ciseaux", icon: "✊" },
  { key: "dunkshot", label: "Dunkshot", icon: "🏀" },
  { key: "tictactoe", label: "Morpion (Tic-Tac-Toe)", icon: "❌" },
];

const EXISTING_KEYS: GameKey[] = ["hockey", "pong", "rps", "dunkshot"];
const ROOM_KEY = "retro-active-room";

async function post(payload: Record<string, unknown>) {
  const response = await fetch("/api/game-room", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    cache: "no-store",
  });
  const data = await response.json();
  if (!response.ok || !data.ok) throw new Error(data.error || "Impossible de changer de jeu.");
  return data;
}

export default function RoomGameController() {
  const [room, setRoom] = useState<RoomState | null>(null);
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    const code = window.localStorage.getItem(ROOM_KEY);
    if (!code) {
      setRoom(null);
      return;
    }
    try {
      const data = await post({ action: "state", code });
      setRoom(data.room as RoomState);
      setError("");
    } catch {
      // RetroApp gère déjà les rooms expirées / quittées.
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 900);
    return () => window.clearInterval(timer);
  }, [refresh]);

  useEffect(() => {
    const syncTarget = () => {
      const node = document.querySelector<HTMLElement>(".roomMain");
      setTarget((current) => current === node ? current : node);
    };
    syncTarget();
    const observer = new MutationObserver(syncTarget);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!target || !room) return;
    const apply = () => {
      const children = Array.from(target.children) as HTMLElement[];
      const memberIndex = children.findIndex((element) => element.classList.contains("memberGrid"));
      if (memberIndex < 0) return;
      for (let index = 0; index < EXISTING_KEYS.length; index++) {
        const element = children[memberIndex + 1 + index];
        if (!element || element.dataset.roomGameUi === "true") continue;
        const key = EXISTING_KEYS[index];
        element.dataset.retroGameRoot = key;
        element.style.display = room.currentGame === key ? "" : "none";
      }
    };
    apply();
    const timer = window.setInterval(apply, 180);
    return () => window.clearInterval(timer);
  }, [target, room?.currentGame]);

  useEffect(() => {
    if (!room) return;
    document.body.dataset.retroCurrentGame = room.currentGame;
    return () => { delete document.body.dataset.retroCurrentGame; };
  }, [room?.currentGame]);

  async function changeGame(game: GameKey) {
    if (!room || room.hostId !== room.userId || busy || game === room.currentGame) return;
    const previous = room;
    setBusy(true);
    setError("");
    setRoom({ ...room, currentGame: game });
    window.dispatchEvent(new Event("retro:return-room"));
    try {
      const data = await post({ action: "setGame", code: room.code, game });
      setRoom(data.room as RoomState);
    } catch (err) {
      setRoom(previous);
      setError(err instanceof Error ? err.message : "Impossible de changer de jeu.");
    } finally {
      setBusy(false);
    }
  }

  if (!target || !room) return null;
  const isHost = room.hostId === room.userId;
  const selected = GAMES.find((game) => game.key === room.currentGame) ?? GAMES[0];

  return createPortal(<>
    {room.currentGame === "tictactoe" && <div data-room-game-ui="true" className="roomGamePortal"><TicTacToeGame room={room}/></div>}
    <section data-room-game-ui="true" className="gameSwitcherPanel">
      <div className="gameSwitcherCopy">
        <span className="kicker">JEU DE LA ROOM</span>
        <strong>{selected.icon} {selected.label}</strong>
        <small>{isHost ? "Tu peux changer de jeu sans recréer la room." : "Seul l'hôte peut changer le jeu."}</small>
      </div>
      <label className="gameSwitcherSelect">
        <span>Changer de jeu</span>
        <select value={room.currentGame} disabled={!isHost || busy} onChange={(event) => void changeGame(event.target.value as GameKey)}>
          {GAMES.map((game) => <option key={game.key} value={game.key}>{game.icon} {game.label}</option>)}
        </select>
      </label>
      {error && <div className="gameSwitcherError">{error}</div>}
    </section>
  </>, target);
}
