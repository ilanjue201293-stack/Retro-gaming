"use client";

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
