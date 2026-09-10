"use client";

import { useEffect } from "react";

function normalizeBotCopy() {
  document.querySelectorAll<HTMLElement>(".botPlayPanel").forEach((panel) => {
    const title = panel.querySelector<HTMLElement>("strong");
    const description = panel.querySelector<HTMLElement>("small");
    const button = panel.querySelector<HTMLButtonElement>("button");
    if (title && /jouer contre un bot|affronter un bot/i.test(title.textContent || "")) title.textContent = "🤖 Compléter avec un bot";
    if (description && /pas besoin d'attendre|le bot choisit aussi/i.test(description.textContent || "")) description.textContent = "Le bot remplit simplement la place manquante.";
    if (button && /vs\s*bot|jouer\s+vs/i.test(button.textContent || "")) button.textContent = "Compléter et lancer";
  });
}

export default function BotUXEnhancer() {
  useEffect(() => {
    const syncDom = () => normalizeBotCopy();
    syncDom();
    const observer = new MutationObserver(syncDom);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);
  return null;
}
