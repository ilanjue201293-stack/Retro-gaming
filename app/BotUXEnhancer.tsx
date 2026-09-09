"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

type BotDifficulty = "easy" | "normal" | "hard";
type RoomMember = { id: string; username: string; online: boolean; joined_at: string };
type RoomState = { code: string; hostId: string; currentGame: string; members: RoomMember[]; userId: string };
const ROOM_KEY = "retro-active-room";

async function post(path: string, payload: Record<string, unknown>) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    cache: "no-store",
  });
  const data = await response.json();
  if (!response.ok || !data.ok) throw new Error(data.error || "Erreur.");
  return data;
}

function normalizeBotCopy() {
  document.querySelectorAll<HTMLElement>(".botPlayPanel").forEach((panel) => {
    const title = panel.querySelector<HTMLElement>("strong");
    const description = panel.querySelector<HTMLElement>("small");
    const button = panel.querySelector<HTMLButtonElement>("button");

    if (title && /jouer contre un bot|affronter un bot/i.test(title.textContent || "")) {
      title.textContent = "🤖 Compléter avec un bot";
    }
    if (description && /pas besoin d'attendre|le bot choisit aussi/i.test(description.textContent || "")) {
      description.textContent = "Le bot remplit simplement la place manquante.";
    }
    if (button && /vs\s*bot|jouer\s+vs/i.test(button.textContent || "")) {
      button.textContent = "Compléter et lancer";
    }
  });
}

export default function BotUXEnhancer() {
  const [room, setRoom] = useState<RoomState | null>(null);
  const [dunkTarget, setDunkTarget] = useState<HTMLElement | null>(null);
  const [botDifficulty, setBotDifficulty] = useState<BotDifficulty>("normal");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const syncDom = () => {
      normalizeBotCopy();
      const target = Array.from(document.querySelectorAll<HTMLElement>(".dunkSetupPanel"))
        .find((element) => /duel à élimination/i.test(element.textContent || "")) ?? null;
      setDunkTarget((current) => current === target ? current : target);
    };
    syncDom();
    const observer = new MutationObserver(syncDom);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let alive = true;
    let inFlight = false;
    const refresh = async () => {
      if (!alive || inFlight) return;
      const code = window.localStorage.getItem(ROOM_KEY);
      if (!code) { setRoom(null); return; }
      inFlight = true;
      try {
        const data = await post("/api/game-room", { action: "state", code });
        if (alive) setRoom(data.room as RoomState);
      } catch {
        // La gestion principale de room affiche déjà les erreurs nécessaires.
      } finally {
        inFlight = false;
      }
    };
    void refresh();
    const timer = window.setInterval(refresh, 1000);
    return () => { alive = false; window.clearInterval(timer); };
  }, []);

  useEffect(() => {
    if (!room || room.currentGame !== "dunkshot" || room.hostId !== room.userId) return;
    let inFlight = false;
    const tick = async () => {
      if (inFlight || document.visibilityState !== "visible") return;
      inFlight = true;
      try { await post("/api/dunkshot-bot", { action: "tick", code: room.code }); } catch {}
      finally { inFlight = false; }
    };
    void tick();
    const timer = window.setInterval(tick, 480);
    return () => window.clearInterval(timer);
  }, [room?.code, room?.currentGame, room?.hostId, room?.userId]);

  async function startDunkBot() {
    if (!room || busy) return;
    try {
      setBusy(true); setError("");
      await post("/api/dunkshot-bot", { action: "startBot", code: room.code, botDifficulty });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Impossible d'ajouter le bot.");
    } finally {
      setBusy(false);
    }
  }

  const showDunkBot = Boolean(
    room &&
    room.currentGame === "dunkshot" &&
    room.hostId === room.userId &&
    room.members.filter((member) => member.online).length < 2 &&
    dunkTarget
  );

  if (!showDunkBot || !dunkTarget) return null;

  return createPortal(
    <div className="botPlayPanel dunkBotFillPanel">
      <div>
        <strong>🤖 Compléter avec un bot</strong>
        <small>Le bot remplit la deuxième place du 1v1 uniquement parce qu'il manque un joueur.</small>
      </div>
      <select value={botDifficulty} onChange={(event) => setBotDifficulty(event.target.value as BotDifficulty)}>
        <option value="easy">Facile</option>
        <option value="normal">Normal</option>
        <option value="hard">Difficile</option>
      </select>
      <button disabled={busy} onClick={() => void startDunkBot()}>{busy ? "Ajout…" : "Compléter et lancer"}</button>
      {error && <small className="botFillError">{error}</small>}
    </div>,
    dunkTarget,
  );
}
