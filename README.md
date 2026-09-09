# Retro Gaming

Portail privé de mini-jeux entre amis avec rooms persistantes, chat et vocal de groupe.

## Jeux

- Hockey Arcade : 1v1, 2v1 et 2v2, équipes configurables, bots, score et temps personnalisables, countdown synchronisé au lancement et après les buts
- Pong : 1v1 humain ou bot, score et temps personnalisables
- Pierre · Feuille · Ciseaux : 1v1 humain ou bot, nombre de manches configurable
- Dunkshot : solo ou 1v1 tour par tour, tir à la puissance et à l'angle, vies configurables, panier mobile et difficulté progressive

## Inclus

- Comptes avec pseudo + mot de passe
- Mot de passe haché côté serveur avec `scrypt`
- Sessions HTTP-only persistantes
- Amis + demandes d'amis
- Statut en ligne / hors ligne
- Rooms privées avec code à 5 caractères
- Invitations de room aux amis
- Chat texte de room + notifications
- Appel vocal de groupe WebRTC
- Membres de room + transfert automatique de l'hôte
- Rejouer ou retourner au lobby de chaque jeu
- Supabase/Postgres
- Création automatique des tables

## Vercel + Supabase

1. Importe ce repo dans Vercel.
2. Connecte Supabase au projet Vercel.
3. Vérifie que `POSTGRES_URL` existe.
4. Redéploie.
5. Crée ton premier compte.

Aucun SQL manuel n'est nécessaire.
