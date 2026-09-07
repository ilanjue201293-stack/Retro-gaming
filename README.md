# Retro Gaming

Portail privé de mini-jeux entre amis. Cette première version contient l'infrastructure sociale, sans jeu activé pour le moment.

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
- Supabase/Postgres
- Création automatique des tables
- Aucun jeu pour l'instant

## Vercel + Supabase

1. Importe ce repo dans Vercel.
2. Connecte Supabase au projet Vercel.
3. Vérifie que `POSTGRES_URL` existe.
4. Redéploie.
5. Crée ton premier compte.

Aucun SQL manuel n'est nécessaire.
