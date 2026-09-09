export const GAME_REGISTRY = [
  { key: "hockey", label: "Hockey Arcade", icon: "🏒", meta: "ARCADE · MULTI", description: "Hockey temps réel avec 1v1, 2v1, 2v2 et bots." },
  { key: "pong", label: "Pong", icon: "▮●▮", meta: "ARCADE · 2 JOUEURS", description: "Le classique Pong en duel, avec bots et réglages de score." },
  { key: "rps", label: "Pierre · Feuille · Ciseaux", icon: "✊", meta: "DUEL · 2 JOUEURS", description: "Choisis en secret puis découvre le résultat après le décompte." },
  { key: "dunkshot", label: "Dunkshot", icon: "🏀", meta: "ARCADE · SOLO / 1V1", description: "Dose l'angle et la puissance pour enchaîner les paniers." },
  { key: "pool", label: "Billard", icon: "🎱", meta: "8-BALL · SOLO / 1V1", description: "Billard physique avec pleines, rayées, bots et vraie visée." },
  { key: "tictactoe", label: "Morpion (Tic-Tac-Toe)", icon: "❌⭕", meta: "CLASSIQUE · 2 JOUEURS", description: "Aligne trois symboles avant ton adversaire, ou joue contre un bot." },
  { key: "higherlower", label: "Le Plus ou Moins", icon: "🔢", meta: "LOGIQUE · SOLO", description: "Le programme choisit un nombre : trouve-le grâce aux indices plus ou moins." },
  { key: "hangman", label: "Le Pendu", icon: "📝", meta: "MOTS · MULTI", description: "Proposez lettres ou mot entier chacun votre tour, avec un nombre d'essais réglable." },
  { key: "flappy", label: "Flappy", icon: "🐤", meta: "ARCADE · SOLO", description: "Saute au bon moment et traverse un maximum de tuyaux sans collision." },
] as const;

export type GameKey = (typeof GAME_REGISTRY)[number]["key"];
export const BASE_LIBRARY_KEYS: GameKey[] = ["hockey", "pong", "rps", "dunkshot"];
