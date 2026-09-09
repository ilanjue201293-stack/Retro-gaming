from pathlib import Path
import re

ROOT = Path('.')

def read(path: str) -> str:
    return (ROOT / path).read_text(encoding='utf-8')

def write(path: str, content: str):
    p = ROOT / path
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(content, encoding='utf-8')

def replace_once(path: str, old: str, new: str):
    p = ROOT / path
    text = p.read_text(encoding='utf-8')
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{path}: expected exactly one occurrence, got {count}: {old[:100]!r}')
    p.write_text(text.replace(old, new, 1), encoding='utf-8')

def regex_once(path: str, pattern: str, replacement: str, flags=0):
    p = ROOT / path
    text = p.read_text(encoding='utf-8')
    updated, count = re.subn(pattern, replacement, text, count=1, flags=flags)
    if count != 1:
        raise SystemExit(f'{path}: regex expected once, got {count}: {pattern[:100]!r}')
    p.write_text(updated, encoding='utf-8')

# ---------------------------------------------------------------------------
# Hangman: large word bank + server-authoritative, turn-by-turn multiplayer.
# ---------------------------------------------------------------------------
write('lib/hangman-words.ts', r'''export const HANGMAN_WORDS = Array.from(new Set(`
ARCADE AVENTURE ABRICOT ACADEMIE ACCORDEON AEROPORT AFFICHE AGRICULTURE ALBATROS ALBUM ALCHIMIE
ALIMENT ALPINISME AMBULANCE AMETHYSTE AMIRAL AMPOULE ANANAS ANCRE ANIMAL ANTENNE APPAREIL AQUARIUM
ARCHIPEL ARCHITECTE ARGENT ARMOIRE ASTRONAUTE ATELIER ATHLETE ATMOSPHERE AUBERGE AUTOMOBILE AVION
BAGUETTE BALEINE BALLON BAMBOU BANANE BASKET BATTERIE BIBLIOTHEQUE BICYCLETTE BILLARD BISCUIT BISON
BOISSON BOOMERANG BOUSSOLE BOUTEILLE BRACELET BRANCHE BRIQUE BROCOLI BRONZE CABANE CACAO CACTUS
CAHIER CAMERA CAMPAGNE CANAPE CANYON CAPITAINE CARAVANE CAROTTE CARTABLE CASCADE CASQUE CASSEROLE
CASTOR CAVERNE CEINTURE CERISE CHAMEAU CHAMPION CHANDELLE CHAPEAU CHATEAU CHAUSSETTE CHEMINEE CHEVAL
CHOCOLAT CHOUETTE CIRCUIT CITRON CLAVIER CLOWN COCCINELLE COFFRE COLLINE COMETE CONSOLE CORAIL CORBEAU
COURONNE COUSSIN CRAYON CROCODILE CUISINE CYCLISTE DAUPHIN DESERT DIAMANT DINOSAURE DISQUE DRAGON
DRAPEAU ECHELLE ECOLE ECLAIR ECUREUIL ELEPHANT ENIGME ESCALADE ESPACE ETOILE FALAISE FANTOME FARINE
FENETRE FESTIVAL FEUILLE FLAMANT FLEUVE FLOCON FORET FORTERESSE FOSSE FOUCHE FOURCHETTE FROMAGE FUSEE
GALAXIE GARAGE GATEAU GIRAFE GLACIER GORILLE GRENOUILLE GUITARE HAMAC HARMONICA HERISSON HIBOU HOCKEY
HORLOGE HORIZON HOTEL ILE IMPRIMANTE INSECTE JARDIN JONQUILLE JOURNAL JUMELLES KANGOUROU KAYAK KOALA
LABYRINTHE LAMPE LANTERNE LEOPARD LICORNE LIVRE LOCOMOTIVE LUNE LUNETTES MACHINE MAGICIEN MAGNETIQUE
MAISON MANDARINE MANETTE MANGUE MARATHON MARTEAU MASQUE MEDAILLE MELON METEORITE MICROPHONE MONTAGNE
MONTGOLFIERE MOTEUR MOUETTE MOUSTACHE MOUTON MUSIQUE MYSTERE NATURE NAVETTE NEIGE NUAGE OCEAN OCTOPUS
ORDINATEUR ORCHESTRE ORIGAMI PANDA PANIER PAPILLON PARACHUTE PARAPLUIE PASTAQUE PATINAGE PELICAN PENDULE
PERROQUET PHARE PIANO PIEUVRE PILOTE PINCEAU PINGOUIN PIRATE PIXEL PLANETE PLATEAU PLONGEE POIRE POISSON
POMME PONT PORTAIL POTAGER PRAIRIE PRISME PUZZLE PYRAMIDE RAQUETTE RENARD ROBOT ROCHER ROCKET ROLLER
ROSE ROUE RUBIS SABLE SACADOS SATELLITE SAXOPHONE SCORPION SERPENT SKATEBOARD SOLEIL SOUSMARIN SPHINX
SPORT STADE STATUE SURF TABLETTE TAMBOUR TELESCOPE TEMPLE TEMPETE TIGRE TOBOGGAN TOMATE TORTUE TOURNEVIS
TRAIN TRAMPOLINE TRESOR TRIANGLE TROMPETTE TROPHEE TUNNEL TURQUOISE UNIFORME VAISSEAU VALISE VELO
VENTILATEUR VIOLON VOLCAN VOYAGE ZEBRE
ACCELERATION ACOUSTIQUE ADRENALINE ALGORITHME ALLIANCE AMBASSADE AMPHIBIE ANIMATION ANTIQUITE APICULTEUR
ARBITRE ARCHIVES ARMATURE ARTIFICE ASTRONOMIE AVENTURIER BALANCOIRE BARRIERE BATEAU BAVARDAGE BEIGNET
BOULANGER BOUSSOLE BRICOLAGE BROUILLARD CABRIOLET CALENDRIER CAMOUFLAGE CAPTEUR CARNAVAL CARROUSEL
CATHEDRALE CERF_VOLANT CHAMPIGNON CHANSON CHEVALIER CHRONOMETRE CINEMA CITROUILLE COLLECTION COMPAS
CONSTELLATION CONTINENT COQUILLAGE CRATERE CREPUSCULE CRISTAL DELTAPLANE DOCUMENT DOMINO DRONE ECHARPE
ECLIPSE ECOSYSTEME ECOUTEURS EMERAUDE ENCYCLOPEDIE ENERGIE ENVELOPPE ESCARGOT EXPLORATEUR FALAFEL
FAMILLE FENNEC FERMETURE FEUILLAGE FEUXARTIFICE FIGURINE FLUTE FOOTBALL FORMULE FOURMI FRAMBOISE
FUNAMBULE GEOMETRIE GIRouETTE GLOBE GOURDE GRAFFITI HAMBURGER HELICOPTERE HISTOIRE HOLOGRAMME ICEBERG
JAGUAR JEUVIDEO JUMELAGE KIOSQUE LABORATOIRE LACET LAVANDE LEMURIEN LIMONADE LUCIOLE MARMOTTE MEDUSE
MINIGOLF MOSAIQUE NAVIGATION NEBULEUSE ORAGE ORCHIDEE PANORAMA PANTHERE PARC PALMIER PENDULE PENTATHLON
PHOTOGRAPHIE PLANISPHERE PLATEFORME PLUME PODIUM POLAROID PORTABLE PROJECTEUR QUARTZ RANDONNEE RECIF
ROBOTIQUE SANDWICH SCAPHANDRE SCULPTURE SEMAPHORE SILHOUETTE SIMULATEUR SKATE SNOWBOARD SONNETTE
SPIRALE STALACTITE SURPRISE SYMPHONIE TELECOMMANDE TERRARIUM THERMOMETRE TORNade TRAJECTOIRE TRIBUNE
TROTTINETTE UNIVERS VITRAIL VOLLEYBALL WAGON WEBCAM XYLOPHONE ZODIAQUE
`.replace(/_/g, '').trim().split(/\s+/).filter(Boolean)));

export function randomHangmanWord() {
  return HANGMAN_WORDS[Math.floor(Math.random() * HANGMAN_WORDS.length)] ?? "ARCADE";
}
''')

# Fix two intentionally lower-case fragments in the source list after normalization at build time.
replace_once('lib/hangman-words.ts', 'GIRouETTE', 'GIROUETTE')
replace_once('lib/hangman-words.ts', 'TORNade', 'TORNADE')

# Add Hangman DB schema alongside other room games.
replace_once('lib/game-room.ts', '''      alter table retro_tictactoe_games add column if not exists bot_o boolean not null default false;\n      alter table retro_tictactoe_games add column if not exists bot_difficulty text not null default 'normal';''', '''      alter table retro_tictactoe_games add column if not exists bot_o boolean not null default false;\n      alter table retro_tictactoe_games add column if not exists bot_difficulty text not null default 'normal';\n\n      create table if not exists retro_hangman_games (\n        room_code text primary key references retro_rooms(code) on delete cascade,\n        status text not null default 'lobby',\n        players jsonb not null default '[]'::jsonb,\n        word text not null default '',\n        guessed_letters jsonb not null default '[]'::jsonb,\n        wrong_words jsonb not null default '[]'::jsonb,\n        errors integer not null default 0,\n        max_errors integer not null default 7,\n        turn_index integer not null default 0,\n        won boolean,\n        last_action jsonb,\n        updated_at timestamptz not null default now()\n      );\n\n      alter table retro_rooms add column if not exists game_control_seq bigint not null default 0;\n      alter table retro_rooms add column if not exists game_control_action text;\n      alter table retro_rooms add column if not exists game_control_game text;''')
replace_once('lib/game-room.ts', '''export async function ensureTicTacToeRow(code: string) {\n  await ensureGameRoomSchema();\n  await db().query(\n    `insert into retro_tictactoe_games (room_code) values ($1)\n     on conflict (room_code) do nothing`,\n    [code]\n  );\n}\n''', '''export async function ensureTicTacToeRow(code: string) {\n  await ensureGameRoomSchema();\n  await db().query(\n    `insert into retro_tictactoe_games (room_code) values ($1)\n     on conflict (room_code) do nothing`,\n    [code]\n  );\n}\n\nexport async function ensureHangmanRow(code: string) {\n  await ensureGameRoomSchema();\n  await db().query(\n    `insert into retro_hangman_games (room_code) values ($1)\n     on conflict (room_code) do nothing`,\n    [code]\n  );\n}\n''')

write('app/api/hangman/route.ts', r'''import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { ensureHangmanRow } from "@/lib/game-room";
import { randomHangmanWord } from "@/lib/hangman-words";
import { requireRoomMember } from "@/lib/room";
import { cleanRoomCode } from "@/lib/utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Player = { userId: string; username: string };
type LastAction = { username: string; value: string; kind: "letter" | "word"; correct: boolean };
type Row = {
  room_code: string;
  status: "lobby" | "playing" | "gameover";
  players: unknown;
  word: string;
  guessed_letters: unknown;
  wrong_words: unknown;
  errors: number;
  max_errors: number;
  turn_index: number;
  won: boolean | null;
  last_action: unknown;
};

async function body(req: NextRequest) { try { return await req.json(); } catch { return {}; } }
const normalize = (value: unknown) => String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/[^A-Z]/g, "");
const playersOf = (value: unknown): Player[] => Array.isArray(value) ? value.filter((item): item is Player => Boolean(item && typeof item === "object" && "userId" in item && "username" in item)) : [];
const stringsOf = (value: unknown) => Array.isArray(value) ? value.map(String) : [];

async function getRow(code: string) {
  await ensureHangmanRow(code);
  const result = await db().query<Row>(`select room_code,status,players,word,guessed_letters,wrong_words,errors,max_errors,turn_index,won,last_action from retro_hangman_games where room_code=$1 limit 1`, [code]);
  if (!result.rows[0]) throw new Error("Pendu indisponible.");
  return result.rows[0];
}

async function skipOfflineTurn(row: Row) {
  if (row.status !== "playing") return row;
  const players = playersOf(row.players);
  if (players.length < 2) return row;
  const online = await db().query<{ user_id: string }>(`select user_id from retro_room_members where room_code=$1 and last_seen>now()-interval '15 seconds'`, [row.room_code]);
  const onlineIds = new Set(online.rows.map((entry) => entry.user_id));
  let index = Math.max(0, Number(row.turn_index) || 0) % players.length;
  if (onlineIds.has(players[index]?.userId)) return row;
  for (let offset = 1; offset <= players.length; offset++) {
    const candidate = (index + offset) % players.length;
    if (onlineIds.has(players[candidate].userId)) {
      await db().query(`update retro_hangman_games set turn_index=$1,updated_at=now() where room_code=$2 and status='playing'`, [candidate, row.room_code]);
      return await getRow(row.room_code);
    }
  }
  return row;
}

function output(row: Row, userId: string) {
  const players = playersOf(row.players);
  const letters = stringsOf(row.guessed_letters);
  const guessed = new Set(letters);
  const current = players.length ? players[Math.max(0, Number(row.turn_index) || 0) % players.length] : null;
  const reveal = row.status === "gameover";
  return {
    status: row.status,
    players,
    displayWord: row.word ? row.word.split("").map((letter) => reveal || guessed.has(letter) ? letter : "_").join(" ") : "",
    revealedWord: reveal ? row.word : null,
    guessedLetters: letters,
    wrongWords: stringsOf(row.wrong_words),
    errors: Math.max(0, Number(row.errors) || 0),
    maxErrors: Math.max(4, Math.min(15, Number(row.max_errors) || 7)),
    turnIndex: Math.max(0, Number(row.turn_index) || 0),
    currentPlayerId: current?.userId ?? null,
    currentPlayerName: current?.username ?? null,
    isMyTurn: row.status === "playing" && current?.userId === userId,
    won: row.won,
    lastAction: row.last_action && typeof row.last_action === "object" ? row.last_action as LastAction : null,
  };
}

export async function POST(req: NextRequest) {
  try {
    const data = await body(req);
    const code = cleanRoomCode(data.code);
    if (code.length !== 5) throw new Error("Code de room invalide.");
    const user = await requireUser(req);
    const membership = await requireRoomMember(code, user);
    const action = String(data.action ?? "state");
    await ensureHangmanRow(code);

    if (action === "state") return NextResponse.json({ ok: true, game: output(await skipOfflineTurn(await getRow(code)), user.id) });

    if (action === "configure") {
      if (membership.host_user_id !== user.id) throw new Error("Seul l'hôte peut régler le Pendu.");
      const maxErrors = Math.max(4, Math.min(15, Math.round(Number(data.maxErrors) || 7)));
      await db().query(`update retro_hangman_games set max_errors=$1,status='lobby',players='[]'::jsonb,word='',guessed_letters='[]'::jsonb,wrong_words='[]'::jsonb,errors=0,turn_index=0,won=null,last_action=null,updated_at=now() where room_code=$2`, [maxErrors, code]);
      return NextResponse.json({ ok: true, game: output(await getRow(code), user.id) });
    }

    if (action === "start") {
      if (membership.host_user_id !== user.id) throw new Error("Seul l'hôte peut lancer le Pendu.");
      const members = await db().query<{ id: string; username: string }>(`select u.id,u.username from retro_room_members m join retro_users u on u.id=m.user_id where m.room_code=$1 and m.last_seen>now()-interval '15 seconds' order by case when u.id=$2 then 0 else 1 end,m.joined_at limit 8`, [code, user.id]);
      if (!members.rows.length) throw new Error("Aucun joueur connecté.");
      const players: Player[] = members.rows.map((member) => ({ userId: member.id, username: member.username }));
      const previous = await getRow(code);
      const maxErrors = Math.max(4, Math.min(15, Number(previous.max_errors) || 7));
      await db().query(`update retro_hangman_games set status='playing',players=$1::jsonb,word=$2,guessed_letters='[]'::jsonb,wrong_words='[]'::jsonb,errors=0,max_errors=$3,turn_index=0,won=null,last_action=null,updated_at=now() where room_code=$4`, [JSON.stringify(players), randomHangmanWord(), maxErrors, code]);
      return NextResponse.json({ ok: true, game: output(await getRow(code), user.id) });
    }

    if (action === "guess") {
      const proposal = normalize(data.proposal);
      if (!proposal || proposal.length > 40) throw new Error("Proposition invalide.");
      const client = await db().connect();
      try {
        await client.query("begin");
        const result = await client.query<Row>(`select room_code,status,players,word,guessed_letters,wrong_words,errors,max_errors,turn_index,won,last_action from retro_hangman_games where room_code=$1 for update`, [code]);
        const row = result.rows[0];
        if (!row || row.status !== "playing") throw new Error("La partie n'est pas en cours.");
        const players = playersOf(row.players);
        if (!players.length) throw new Error("Aucun joueur dans la partie.");
        const turnIndex = Math.max(0, Number(row.turn_index) || 0) % players.length;
        const current = players[turnIndex];
        if (current.userId !== user.id) throw new Error(`C'est au tour de ${current.username}.`);
        const guessed = stringsOf(row.guessed_letters);
        const wrongWords = stringsOf(row.wrong_words);
        let errors = Math.max(0, Number(row.errors) || 0);
        const maxErrors = Math.max(4, Math.min(15, Number(row.max_errors) || 7));
        let correct = false;
        const kind: "letter" | "word" = proposal.length === 1 ? "letter" : "word";
        if (kind === "letter") {
          if (guessed.includes(proposal)) throw new Error("Cette lettre a déjà été proposée.");
          guessed.push(proposal);
          correct = row.word.includes(proposal);
          if (!correct) errors += 1;
        } else {
          if (wrongWords.includes(proposal)) throw new Error("Ce mot a déjà été proposé.");
          correct = proposal === row.word;
          if (correct) {
            for (const letter of new Set(row.word.split(""))) if (!guessed.includes(letter)) guessed.push(letter);
          } else {
            wrongWords.push(proposal);
            errors += 1;
          }
        }
        const solved = row.word.split("").every((letter) => guessed.includes(letter));
        const gameover = solved || errors >= maxErrors;
        const nextTurn = gameover ? turnIndex : (turnIndex + 1) % players.length;
        const lastAction: LastAction = { username: user.username, value: proposal, kind, correct };
        await client.query(`update retro_hangman_games set guessed_letters=$1::jsonb,wrong_words=$2::jsonb,errors=$3,turn_index=$4,won=$5,status=$6,last_action=$7::jsonb,updated_at=now() where room_code=$8`, [JSON.stringify(guessed), JSON.stringify(wrongWords), errors, nextTurn, gameover ? solved : null, gameover ? "gameover" : "playing", JSON.stringify(lastAction), code]);
        await client.query("commit");
      } catch (error) {
        try { await client.query("rollback"); } catch {}
        throw error;
      } finally { client.release(); }
      return NextResponse.json({ ok: true, game: output(await getRow(code), user.id) });
    }

    if (action === "stop") {
      if (membership.host_user_id !== user.id) throw new Error("Seul l'hôte peut arrêter le Pendu.");
      await db().query(`update retro_hangman_games set status='lobby',players='[]'::jsonb,word='',guessed_letters='[]'::jsonb,wrong_words='[]'::jsonb,errors=0,turn_index=0,won=null,last_action=null,updated_at=now() where room_code=$1`, [code]);
      return NextResponse.json({ ok: true, game: output(await getRow(code), user.id) });
    }

    throw new Error("Action Pendu inconnue.");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erreur inconnue.";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
''')

write('app/HangmanGame.tsx', r'''"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

type RoomMember = { id: string; username: string; online: boolean; joined_at: string };
type Room = { code: string; hostId: string; members: RoomMember[]; userId: string };
type Player = { userId: string; username: string };
type LastAction = { username: string; value: string; kind: "letter" | "word"; correct: boolean };
type Game = {
  status: "lobby" | "playing" | "gameover";
  players: Player[];
  displayWord: string;
  revealedWord: string | null;
  guessedLetters: string[];
  wrongWords: string[];
  errors: number;
  maxErrors: number;
  turnIndex: number;
  currentPlayerId: string | null;
  currentPlayerName: string | null;
  isMyTurn: boolean;
  won: boolean | null;
  lastAction: LastAction | null;
};

const TRY_OPTIONS = [5, 7, 10, 12, 15];
async function post(payload: Record<string, unknown>) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 5500);
  try {
    const response = await fetch("/api/hangman", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload), cache: "no-store", signal: controller.signal });
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.error || "Pendu indisponible.");
    return data;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw new Error("Le Pendu met trop de temps à répondre.");
    throw error;
  } finally { window.clearTimeout(timeout); }
}

export default function HangmanGame({ room }: { room: Room }) {
  const [game, setGame] = useState<Game | null>(null);
  const [wordEntry, setWordEntry] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const isHost = room.hostId === room.userId;

  useEffect(() => {
    let alive = true, inFlight = false, timer = 0;
    const poll = async () => {
      if (!alive || inFlight || document.visibilityState === "hidden") return;
      inFlight = true;
      try { const data = await post({ action: "state", code: room.code }); if (alive) { setGame(data.game as Game); setError(""); } }
      catch (err) { if (alive && !game) setError(err instanceof Error ? err.message : "Pendu indisponible."); }
      finally { inFlight = false; }
    };
    void poll();
    timer = window.setInterval(poll, game?.status === "playing" ? 450 : 1200);
    return () => { alive = false; window.clearInterval(timer); };
  }, [room.code, game?.status]);

  const action = async (name: "start" | "stop" | "configure", extra: Record<string, unknown> = {}) => {
    try { setBusy(true); setError(""); const data = await post({ action: name, code: room.code, ...extra }); setGame(data.game as Game); setWordEntry(""); }
    catch (err) { setError(err instanceof Error ? err.message : "Action impossible."); }
    finally { setBusy(false); }
  };
  const guess = async (proposal: string) => {
    if (!game?.isMyTurn || busy) return;
    try { setBusy(true); setError(""); const data = await post({ action: "guess", code: room.code, proposal }); setGame(data.game as Game); setWordEntry(""); }
    catch (err) { setError(err instanceof Error ? err.message : "Proposition impossible."); }
    finally { setBusy(false); }
  };
  const submitWord = (event: FormEvent) => { event.preventDefault(); if (wordEntry.trim().length >= 2) void guess(wordEntry); };
  const used = useMemo(() => new Set(game?.guessedLetters ?? []), [game?.guessedLetters]);
  const stage = game ? Math.min(7, Math.ceil((game.errors / Math.max(1, game.maxErrors)) * 7)) : 0;

  if (!game) return <section className="miniGameCard hangmanGame"><div className="spinner"/><p>Chargement du Pendu…</p>{error && <div className="errorBox">{error}</div>}</section>;

  if (game.status === "lobby") return <section className="miniGameCard hangmanGame">
    <div className="miniHeroIcon">📝</div><span className="kicker">MOTS · MULTIJOUEUR</span><h2>Le Pendu</h2>
    <p>Le serveur choisit un mot secret. Vous proposez chacun votre tour une lettre ou directement le mot entier.</p>
    <div className="hangmanLobbySetup">
      <div><strong>{room.members.filter((member) => member.online).length} joueur{room.members.filter((member) => member.online).length > 1 ? "s" : ""} connecté{room.members.filter((member) => member.online).length > 1 ? "s" : ""}</strong><small>Jusqu'à 8 joueurs peuvent participer dans la même partie.</small></div>
      <label><span>Nombre d'essais</span><select value={game.maxErrors} disabled={!isHost || busy} onChange={(event) => void action("configure", { maxErrors: Number(event.target.value) })}>{TRY_OPTIONS.map((value) => <option key={value} value={value}>{value} erreurs</option>)}</select></label>
      {isHost ? <button className="primaryButton" disabled={busy} onClick={() => void action("start")}>{busy ? "Lancement…" : "Lancer le Pendu"}</button> : <small>En attente de l'hôte…</small>}
    </div>{error && <div className="errorBox">{error}</div>}
  </section>;

  return <section className="miniGameCard hangmanGame hangmanMulti">
    <div className="miniGameTop"><div><span className="kicker">LE PENDU · TOUR PAR TOUR</span><h2>{game.status === "gameover" ? (game.won ? "Mot trouvé !" : "Mot perdu !") : game.isMyTurn ? "À toi de jouer" : `Tour de ${game.currentPlayerName ?? "…"}`}</h2></div><div className="miniStat"><small>ERREURS</small><strong>{game.errors}/{game.maxErrors}</strong></div></div>
    <div className="hangmanPlayers">{game.players.map((player, index) => <span key={player.userId} className={game.status === "playing" && index === game.turnIndex ? "turn" : ""}>{index === game.turnIndex && game.status === "playing" ? "▶ " : ""}{player.username}{player.userId === room.userId ? " (toi)" : ""}</span>)}</div>
    <div className="hangmanStage"><div className={`hangmanFigure errors-${stage}`}><i className="rope"/><i className="head"/><i className="body"/><i className="arm left"/><i className="arm right"/><i className="leg left"/><i className="leg right"/></div><div><div className="hangmanWord">{game.displayWord}</div>{game.status === "gameover" && <div className="hangmanReveal">Mot : <strong>{game.revealedWord}</strong></div>}</div></div>
    {game.lastAction && <div className={`hangmanLastAction ${game.lastAction.correct ? "correct" : "wrong"}`}>{game.lastAction.username} a proposé <strong>{game.lastAction.value}</strong> · {game.lastAction.correct ? "bon !" : "raté"}</div>}
    {game.status === "playing" && <>
      <div className="letterGrid">{"ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").map((letter) => <button key={letter} disabled={busy || !game.isMyTurn || used.has(letter)} onClick={() => void guess(letter)}>{letter}</button>)}</div>
      <form className="hangmanWordGuess" onSubmit={submitWord}><input value={wordEntry} disabled={!game.isMyTurn || busy} maxLength={40} onChange={(event) => setWordEntry(event.target.value)} placeholder={game.isMyTurn ? "Tu penses avoir trouvé ? Écris le mot entier" : `Attends le tour de ${game.currentPlayerName ?? "l'autre joueur"}`}/><button className="primaryButton" disabled={!game.isMyTurn || busy || wordEntry.trim().length < 2}>Proposer le mot</button></form>
      {!!game.wrongWords.length && <div className="hangmanWrongWords"><small>MOTS RATÉS</small>{game.wrongWords.map((word) => <span key={word}>{word}</span>)}</div>}
    </>}
    {game.status === "gameover" && (isHost ? <div className="miniGameActions"><button className="primaryButton" disabled={busy} onClick={() => void action("start")}>↻ Rejouer</button><button className="secondaryButton" disabled={busy} onClick={() => void action("stop")}>Lobby du jeu</button></div> : <small>En attente de l'hôte pour rejouer…</small>)}
    {error && <div className="errorBox">{error}</div>}
  </section>;
}
''')

# ---------------------------------------------------------------------------
# Game room state: reset ghost games when switching and synchronize local host controls.
# ---------------------------------------------------------------------------
replace_once('app/api/game-room/route.ts', 'import { ensureGameRoomSchema, ensureTicTacToeRow, isRoomGameKey } from "@/lib/game-room";', 'import { ensureGameRoomSchema, ensureHangmanRow, ensureTicTacToeRow, isRoomGameKey } from "@/lib/game-room";')
replace_once('app/api/game-room/route.ts', '''async function roomState(code: string, userId: string) {\n  const room = await db().query<{ host_user_id: string; current_game: string }>(\n    `select host_user_id,current_game from retro_rooms where code=$1 and expires_at>now() limit 1`,''', '''async function resetActiveGames(code: string) {\n  const queries = [\n    `update retro_hockey_games set status='lobby',players='[]'::jsonb,left_score=0,right_score=0,winner_side=null,updated_at=now() where room_code=$1`,\n    `update retro_pong_games set status='lobby',players='[]'::jsonb,left_score=0,right_score=0,winner_side=null,started_at=null,updated_at=now() where room_code=$1`,\n    `update retro_rps_games set status='lobby',players='[]'::jsonb,round_index=0,left_score=0,right_score=0,choices='{}'::jsonb,phase='choosing',phase_started_at=null,phase_ends_at=null,last_result=null,winner_side=null,updated_at=now() where room_code=$1`,\n    `update retro_dunkshot_games set status='lobby',players='[]'::jsonb,lives='{}'::jsonb,turn_index=0,streak=0,shot=null,last_result=null,winner_id=null,started_at=null,ends_at=null,updated_at=now() where room_code=$1`,\n    `update retro_pool_games set status='lobby',players='[]'::jsonb,turn_index=0,groups='{}'::jsonb,shot=null,winner_id=null,last_message=null,updated_at=now() where room_code=$1`,\n    `update retro_tictactoe_games set status='lobby',player_x_id=null,player_o_id=null,bot_o=false,board='["","","","","","","","",""]'::jsonb,turn='X',winner=null,updated_at=now() where room_code=$1`,\n    `update retro_hangman_games set status='lobby',players='[]'::jsonb,word='',guessed_letters='[]'::jsonb,wrong_words='[]'::jsonb,errors=0,turn_index=0,won=null,last_action=null,updated_at=now() where room_code=$1`,\n  ];\n  await Promise.all(queries.map((query) => db().query(query, [code]).catch(() => undefined)));\n}\n\nasync function roomState(code: string, userId: string) {\n  const room = await db().query<{ host_user_id: string; current_game: string; game_control_seq: string; game_control_action: string | null; game_control_game: string | null }>(\n    `select host_user_id,current_game,game_control_seq::text,game_control_action,game_control_game from retro_rooms where code=$1 and expires_at>now() limit 1`,''')
replace_once('app/api/game-room/route.ts', '''    currentGame: isRoomGameKey(room.rows[0].current_game) ? room.rows[0].current_game : "hockey",\n    members: members.rows,\n    userId,''', '''    currentGame: isRoomGameKey(room.rows[0].current_game) ? room.rows[0].current_game : "hockey",\n    members: members.rows,\n    userId,\n    gameControlSeq: Number(room.rows[0].game_control_seq || 0),\n    gameControlAction: room.rows[0].game_control_action,\n    gameControlGame: room.rows[0].game_control_game,''')
replace_once('app/api/game-room/route.ts', '''      if (membership.host_user_id !== user.id) throw new Error("Seul l'hôte peut changer de jeu.");\n      await db().query(`update retro_rooms set current_game=$1,updated_at=now() where code=$2`, [game, code]);\n      if (game === "tictactoe") await ensureTicTacToeRow(code);\n      return NextResponse.json({ ok: true, room: await roomState(code, user.id) });\n    }\n\n    if (action === "tttState") {''', '''      if (membership.host_user_id !== user.id) throw new Error("Seul l'hôte peut changer de jeu.");\n      await resetActiveGames(code);\n      await db().query(`update retro_rooms set current_game=$1,updated_at=now() where code=$2`, [game, code]);\n      if (game === "tictactoe") await ensureTicTacToeRow(code);\n      if (game === "hangman") await ensureHangmanRow(code);\n      return NextResponse.json({ ok: true, room: await roomState(code, user.id) });\n    }\n\n    if (action === "localControl") {\n      if (membership.host_user_id !== user.id) throw new Error("Seul l'hôte peut contrôler la partie.");\n      const control = String(data.control ?? "");\n      if (!["replay", "lobby", "end"].includes(control)) throw new Error("Commande de jeu invalide.");\n      const current = await roomState(code, user.id);\n      if (current.currentGame !== "higherlower" && current.currentGame !== "flappy") throw new Error("Ce jeu utilise ses propres contrôles réseau.");\n      await db().query(`update retro_rooms set game_control_seq=game_control_seq+1,game_control_action=$1,game_control_game=$2,updated_at=now() where code=$3`, [control, current.currentGame, code]);\n      return NextResponse.json({ ok: true, room: await roomState(code, user.id) });\n    }\n\n    if (action === "tttState") {''')

# ---------------------------------------------------------------------------
# Room controller: Hangman is networked; host controls propagate to local games.
# ---------------------------------------------------------------------------
replace_once('app/RoomGameController.tsx', 'import { useCallback, useEffect, useState } from "react";', 'import { useCallback, useEffect, useRef, useState } from "react";')
replace_once('app/RoomGameController.tsx', 'type RoomState = { code: string; hostId: string; currentGame: GameKey; members: RoomMember[]; userId: string };', 'type RoomState = { code: string; hostId: string; currentGame: GameKey; members: RoomMember[]; userId: string; gameControlSeq?: number; gameControlAction?: string | null; gameControlGame?: string | null };')
replace_once('app/RoomGameController.tsx', 'const LOCAL_GAMES: GameKey[] = ["higherlower", "hangman", "flappy"];', 'const LOCAL_GAMES: GameKey[] = ["higherlower", "flappy"];')
regex_once('app/RoomGameController.tsx', r'async function post\(path: string, payload: Record<string, unknown>\) \{.*?\n\}', '''async function post(path: string, payload: Record<string, unknown>) {\n  const controller = new AbortController();\n  const timeout = window.setTimeout(() => controller.abort(), 5500);\n  try {\n    const response = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload), cache: "no-store", signal: controller.signal });\n    const data = await response.json();\n    if (!response.ok || !data.ok) throw new Error(data.error || "Action impossible.");\n    return data;\n  } finally { window.clearTimeout(timeout); }\n}''', flags=re.S)
replace_once('app/RoomGameController.tsx', '  const [toast, setToast] = useState("");', '  const [toast, setToast] = useState("");\n  const lastControlSeq = useRef<number | null>(null);')
replace_once('app/RoomGameController.tsx', '''    try { const data = await post("/api/game-room", { action: "state", code }); setRoom(data.room as RoomState); setError(""); } catch {}''', '''    try {\n      const data = await post("/api/game-room", { action: "state", code });\n      const next = data.room as RoomState;\n      const seq = Number(next.gameControlSeq || 0);\n      if (lastControlSeq.current === null) lastControlSeq.current = seq;\n      else if (seq > lastControlSeq.current) {\n        lastControlSeq.current = seq;\n        if (next.gameControlGame === next.currentGame && ["replay", "lobby", "end"].includes(next.gameControlAction || "")) {\n          window.dispatchEvent(new CustomEvent("retro:local-game-control", { detail: next.gameControlAction }));\n        }\n      }\n      setRoom(next);\n      window.dispatchEvent(new CustomEvent("retro:room-state", { detail: next }));\n      setError("");\n    } catch {}''')
replace_once('app/RoomGameController.tsx', '''    if (LOCAL_GAMES.includes(room.currentGame)) { window.dispatchEvent(new CustomEvent("retro:local-game-control", { detail: "lobby" })); setToast(`${label} · fait`); return; }''', '''    if (LOCAL_GAMES.includes(room.currentGame)) {\n      setBusy(true);\n      try {\n        const data = await post("/api/game-room", { action: "localControl", code: room.code, control: "lobby" });\n        const next = data.room as RoomState; lastControlSeq.current = Number(next.gameControlSeq || 0); setRoom(next);\n        window.dispatchEvent(new CustomEvent("retro:local-game-control", { detail: "lobby" }));\n        setToast(`${label} · tout le monde est revenu au lobby`);\n      } catch (err) { setError(err instanceof Error ? err.message : "Impossible d'arrêter la partie."); } finally { setBusy(false); }\n      return;\n    }''')
replace_once('app/RoomGameController.tsx', '''      else if (room.currentGame === "tictactoe") await post("/api/game-room", { action: "tttReset", code: room.code });''', '''      else if (room.currentGame === "tictactoe") await post("/api/game-room", { action: "tttReset", code: room.code });\n      else if (room.currentGame === "hangman") await post("/api/hangman", { action: "stop", code: room.code });''')
replace_once('app/RoomGameController.tsx', '''  function replay() {\n    if (!room || room.hostId !== room.userId) return;\n    if (LOCAL_GAMES.includes(room.currentGame)) { window.dispatchEvent(new CustomEvent("retro:local-game-control", { detail: "replay" })); setToast("Nouvelle partie"); return; }''', '''  async function replay() {\n    if (!room || room.hostId !== room.userId) return;\n    if (LOCAL_GAMES.includes(room.currentGame)) {\n      try {\n        const data = await post("/api/game-room", { action: "localControl", code: room.code, control: "replay" });\n        const next = data.room as RoomState; lastControlSeq.current = Number(next.gameControlSeq || 0); setRoom(next);\n        window.dispatchEvent(new CustomEvent("retro:local-game-control", { detail: "replay" })); setToast("Nouvelle partie");\n      } catch (err) { setError(err instanceof Error ? err.message : "Impossible de rejouer."); }\n      return;\n    }''')
replace_once('app/RoomGameController.tsx', 'const replayButton = buttons.find((button) => /rejouer/i.test(button.textContent || "") && !button.disabled);', 'const replayButton = buttons.find((button) => /rejouer|nouvelle partie/i.test(button.textContent || "") && !button.disabled);')
replace_once('app/RoomGameController.tsx', '''  function endGame() {\n    if (!room || room.hostId !== room.userId) return;\n    if (LOCAL_GAMES.includes(room.currentGame)) { window.dispatchEvent(new CustomEvent("retro:local-game-control", { detail: "end" })); setToast("Partie terminée"); return; }''', '''  async function endGame() {\n    if (!room || room.hostId !== room.userId) return;\n    if (LOCAL_GAMES.includes(room.currentGame)) {\n      try {\n        const data = await post("/api/game-room", { action: "localControl", code: room.code, control: "end" });\n        const next = data.room as RoomState; lastControlSeq.current = Number(next.gameControlSeq || 0); setRoom(next);\n        window.dispatchEvent(new CustomEvent("retro:local-game-control", { detail: "end" })); setToast("Partie terminée");\n      } catch (err) { setError(err instanceof Error ? err.message : "Impossible de terminer la partie."); }\n      return;\n    }''')
replace_once('app/RoomGameController.tsx', '<HangmanGame/>', '<HangmanGame room={room}/>')
replace_once('app/RoomGameController.tsx', 'onClick={replay}', 'onClick={() => void replay()}')
replace_once('app/RoomGameController.tsx', 'onClick={endGame}', 'onClick={() => void endGame()}')

# ---------------------------------------------------------------------------
# Central game library: remove DOM enhancer/duplicates and render one registry.
# ---------------------------------------------------------------------------
replace_once('app/gameRegistry.ts', '{ key: "hangman", label: "Le Pendu", icon: "📝", meta: "MOTS · SOLO", description: "Retrouve le mot secret lettre par lettre avant d\'épuiser tes essais." },', '{ key: "hangman", label: "Le Pendu", icon: "📝", meta: "MOTS · MULTI", description: "Proposez lettres ou mot entier chacun votre tour, avec un nombre d\'essais réglable." },')
replace_once('app/RetroApp.tsx', 'import PoolGame from "./PoolGame";', 'import PoolGame from "./PoolGame";\nimport { GAME_REGISTRY, GameKey } from "./gameRegistry";')
replace_once('app/RetroApp.tsx', 'type RoomGameKey = "hockey" | "pong" | "rps" | "dunkshot" | "pool" | "tictactoe" | "higherlower" | "hangman" | "flappy";', 'type RoomGameKey = GameKey;')
regex_once('app/RetroApp.tsx', r'async function post\(path: string, payload: Record<string, unknown>\) \{.*?\n\}', '''async function post(path: string, payload: Record<string, unknown>) {\n  const controller = new AbortController();\n  const timeout = window.setTimeout(() => controller.abort(), 7000);\n  try {\n    const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload), cache: "no-store", signal: controller.signal });\n    const data = await res.json();\n    if (!res.ok || !data.ok) throw new Error(data.error || "Erreur.");\n    return data;\n  } catch (error) {\n    if (error instanceof DOMException && error.name === "AbortError") throw new Error("Le serveur met trop de temps à répondre. Réessaie.");\n    throw error;\n  } finally { window.clearTimeout(timeout); }\n}''', flags=re.S)
replace_once('app/RetroApp.tsx', '  const createRoom = async () => {', '  const createRoom = async (game: RoomGameKey = "hockey") => {')
replace_once('app/RetroApp.tsx', '''      const data = await post("/api/rooms", { action: "create" });\n      setRoom(data.room);\n      setHockeyActive(false);\n      localStorage.setItem(ROOM_KEY, data.room.code);''', '''      const data = await post("/api/rooms", { action: "create" });\n      if (game !== "hockey") await post("/api/game-room", { action: "setGame", code: data.room.code, game });\n      setSelectedRoomGame(game);\n      setRoom(data.room);\n      setHockeyActive(false);\n      localStorage.setItem(ROOM_KEY, data.room.code);''')
# Calls with no args now need wrappers because React passes MouseEvent to async handler.
replace_once('app/RetroApp.tsx', 'onClick={() => void createRoom()}', 'onClick={() => void createRoom("hockey")}')
# Replace the entire gamesPreview section with registry-driven cards.
regex_once('app/RetroApp.tsx', r'''        <section className="gamesPreview">.*?        </section>\n      </section>\n      <aside className="socialColumn">''', '''        <section className="gamesPreview">\n          <div className="panelHead"><div><span className="kicker">JEUX</span><h2>Bibliothèque</h2></div><span className="availablePill">{GAME_REGISTRY.length} JEUX</span></div>\n          {GAME_REGISTRY.map((game) => <div className="gameLibraryCard" data-game-library={game.key} key={game.key}>\n            <div className={`gameLibraryIcon ${game.key === "dunkshot" ? "dunkMiniIcon" : game.key === "pool" ? "poolMiniIcon" : ""}`}>{game.icon}</div>\n            <div><small>{game.meta}</small><h3>{game.label}</h3><p>{game.description}</p></div>\n            <button className="primaryButton" disabled={roomBusy} onClick={() => void createRoom(game.key)}>Créer une room</button>\n          </div>)}\n        </section>\n      </section>\n      <aside className="socialColumn">''', flags=re.S)
replace_once('app/page.tsx', 'import DashboardGameLibraryEnhancer from "./DashboardGameLibraryEnhancer";\n', '')
replace_once('app/page.tsx', '    <DashboardGameLibraryEnhancer />\n', '')
Path('app/DashboardGameLibraryEnhancer.tsx').unlink(missing_ok=True)

# ---------------------------------------------------------------------------
# Hockey: larger goals and physically/visually chamfered corners.
# ---------------------------------------------------------------------------
replace_once('app/HockeyGame.tsx', 'const GOAL_MIN = 0.28;\nconst GOAL_MAX = 0.72;', 'const GOAL_MIN = 0.25;\nconst GOAL_MAX = 0.75;\nconst CORNER_CUT = 0.075;')
insert_before = 'function stepSimulation(simulation: Simulation, players: Player[], mode: Mode, dt: number) {'
helper = r'''function reflectRinkBoundary(puck: Puck) {
  const restitution = 0.96;
  const topY = TOP_BOARD + PUCK_R, bottomY = BOTTOM_BOARD - PUCK_R;
  const leftX = LEFT_BOARD + PUCK_R, rightX = RIGHT_BOARD - PUCK_R;
  const straightLeft = LEFT_BOARD + CORNER_CUT;
  const straightRight = RIGHT_BOARD - CORNER_CUT;
  const straightTop = TOP_BOARD + CORNER_CUT;
  const straightBottom = BOTTOM_BOARD - CORNER_CUT;

  if (puck.x >= straightLeft && puck.x <= straightRight) {
    if (puck.y < topY) { puck.y = topY; if (puck.vy < 0) puck.vy = -puck.vy * restitution; }
    else if (puck.y > bottomY) { puck.y = bottomY; if (puck.vy > 0) puck.vy = -puck.vy * restitution; }
  }
  const inGoalMouth = puck.y > GOAL_MIN && puck.y < GOAL_MAX;
  if (!inGoalMouth && puck.y >= straightTop && puck.y <= straightBottom) {
    if (puck.x < leftX) { puck.x = leftX; if (puck.vx < 0) puck.vx = -puck.vx * restitution; }
    else if (puck.x > rightX) { puck.x = rightX; if (puck.vx > 0) puck.vx = -puck.vx * restitution; }
  }

  const inv = Math.SQRT1_2;
  const corners = [
    { d: ((puck.x - LEFT_BOARD) + (puck.y - TOP_BOARD) - CORNER_CUT) * inv, nx: inv, ny: inv },
    { d: ((RIGHT_BOARD - puck.x) + (puck.y - TOP_BOARD) - CORNER_CUT) * inv, nx: -inv, ny: inv },
    { d: ((puck.x - LEFT_BOARD) + (BOTTOM_BOARD - puck.y) - CORNER_CUT) * inv, nx: inv, ny: -inv },
    { d: ((RIGHT_BOARD - puck.x) + (BOTTOM_BOARD - puck.y) - CORNER_CUT) * inv, nx: -inv, ny: -inv },
  ];
  for (const corner of corners) {
    if (corner.d >= PUCK_R) continue;
    const push = PUCK_R - corner.d;
    puck.x += corner.nx * push; puck.y += corner.ny * push;
    const velocityIntoWall = puck.vx * corner.nx + puck.vy * corner.ny;
    if (velocityIntoWall < 0) {
      puck.vx -= (1 + restitution) * velocityIntoWall * corner.nx;
      puck.vy -= (1 + restitution) * velocityIntoWall * corner.ny;
    }
  }
}

'''
text = read('app/HockeyGame.tsx')
if text.count(insert_before) != 1: raise SystemExit('Hockey stepSimulation anchor missing')
write('app/HockeyGame.tsx', text.replace(insert_before, helper + insert_before, 1))
replace_once('app/HockeyGame.tsx', '''    if (frame.puck.y - PUCK_R < TOP_BOARD) { frame.puck.y = TOP_BOARD + PUCK_R; frame.puck.vy = Math.abs(frame.puck.vy) * 0.96; }\n    if (frame.puck.y + PUCK_R > BOTTOM_BOARD) { frame.puck.y = BOTTOM_BOARD - PUCK_R; frame.puck.vy = -Math.abs(frame.puck.vy) * 0.96; }\n    const inGoalMouth = frame.puck.y > GOAL_MIN && frame.puck.y < GOAL_MAX;\n    if (!inGoalMouth && frame.puck.x - PUCK_R < LEFT_BOARD) { frame.puck.x = LEFT_BOARD + PUCK_R; frame.puck.vx = Math.abs(frame.puck.vx) * 0.96; }\n    if (!inGoalMouth && frame.puck.x + PUCK_R > RIGHT_BOARD) { frame.puck.x = RIGHT_BOARD - PUCK_R; frame.puck.vx = -Math.abs(frame.puck.vx) * 0.96; }''', '''    reflectRinkBoundary(frame.puck);''')
replace_once('app/HockeyGame.tsx', '''    for (const player of players) {\n      const paddle = frame.paddles[player.userId];\n      collidePuckWithPaddle(frame, oldPuck, oldPaddles[player.userId] ?? paddle, paddle, player.side, stepDt);\n    }\n    const goalNow''', '''    for (const player of players) {\n      const paddle = frame.paddles[player.userId];\n      collidePuckWithPaddle(frame, oldPuck, oldPaddles[player.userId] ?? paddle, paddle, player.side, stepDt);\n    }\n    reflectRinkBoundary(frame.puck);\n    const goalNow''')
regex_once('app/HockeyGame.tsx', r'''function predictPuck\(puck: Puck, ageSeconds: number\) \{.*?\n\}''', '''function predictPuck(puck: Puck, ageSeconds: number) {\n  const dt = Math.min(ageSeconds, 0.24);\n  const predicted: Puck = { x: puck.x + puck.vx * dt, y: puck.y + puck.vy * dt, vx: puck.vx, vy: puck.vy };\n  reflectRinkBoundary(predicted);\n  return { ...predicted, x: clamp(predicted.x, -0.04, 1.04), y: clamp(predicted.y, TOP_BOARD, BOTTOM_BOARD) };\n}''', flags=re.S)
replace_once('app/hockey-v6.css', '.goal{top:33%;height:34%}\n.goalCrease{top:31%;height:38%;width:12%}', '.goal{top:25%;height:50%}\n.goalCrease{top:22%;height:56%;width:13%}')
replace_once('app/mini-games.css', '/* Larger hockey cages: visuals match the enlarged 28–72% physics opening. */\n.hockeyRink .goal{top:29%;height:42%}.hockeyRink .goalCrease{top:27%;height:46%}', '/* Hockey rink: 25–75% goal mouth + chamfered corners matching physics. */\n.hockeyRink{border-radius:0!important;clip-path:polygon(7.5% 0,92.5% 0,100% 7.5%,100% 92.5%,92.5% 100%,7.5% 100%,0 92.5%,0 7.5%)}\n.hockeyRink .goal{top:25%;height:50%}.hockeyRink .goalCrease{top:22%;height:56%;width:13%}')

# ---------------------------------------------------------------------------
# Dunkshot audit: timeouts, instant local shot, no stale reset, less React churn,
# full mobile power, faster sync, server stale-shot recovery and cheaper state.
# ---------------------------------------------------------------------------
regex_once('app/DunkshotGame.tsx', r'''async function post\(payload: Record<string, unknown>\) \{.*?\n\}''', '''async function post(payload: Record<string, unknown>) {\n  const controller = new AbortController();\n  const timeout = window.setTimeout(() => controller.abort(), 5500);\n  try {\n    const response = await fetch("/api/dunkshot", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload), cache: "no-store", signal: controller.signal });\n    const data = await response.json();\n    if (!response.ok || !data.ok) throw new Error(data.error || "Erreur Dunkshot.");\n    return data;\n  } catch (error) {\n    if (error instanceof DOMException && error.name === "AbortError") throw new Error("Dunkshot met trop de temps à répondre.");\n    throw error;\n  } finally { window.clearTimeout(timeout); }\n}''', flags=re.S)
replace_once('app/DunkshotGame.tsx', 'if (alive) timer = window.setTimeout(() => void poll(), duelActive ? 350 : 1400);', 'if (alive) timer = window.setTimeout(() => void poll(), duelActive ? 190 : 1100);')
replace_once('app/DunkshotGame.tsx', '''    let raf = 0;\n    const tick = () => { setSceneTime(Date.now()); raf = requestAnimationFrame(tick); };\n    raf = requestAnimationFrame(tick);''', '''    let raf = 0, lastPaint = 0;\n    const tick = (stamp: number) => { if (stamp - lastPaint >= 32) { lastPaint = stamp; setSceneTime(Date.now()); } raf = requestAnimationFrame(tick); };\n    raf = requestAnimationFrame(tick);''')
replace_once('app/DunkshotGame.tsx', '''        const next = { ...current, score: current.score + 1, streak: current.streak + 1 };\n        setSoloRun(next);''', '''        const next = { ...current, score: current.score + 1, streak: current.streak + 1 };\n        soloRunRef.current = next; setSoloRun(next);''')
replace_once('app/DunkshotGame.tsx', '''        const next = { ...current, lives, streak: 0, gameover: lives <= 0 };\n        setSoloRun(next);''', '''        const next = { ...current, lives, streak: 0, gameover: lives <= 0 };\n        soloRunRef.current = next; setSoloRun(next);''')
replace_once('app/DunkshotGame.tsx', '        window.setTimeout(() => setBall(restBall()), 720);\n', '')
replace_once('app/DunkshotGame.tsx', '''    if (soloActive) {\n      const shot: Shot = { id: `solo-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, shooterId: user.id, power, aim: actualAim, startedAt: Date.now() + 70 };\n      setSoloShot(shot);\n      return;\n    }\n    try {\n      const data = await post({ action: "shoot", code: room.code, power, aim: actualAim });\n      setGame(data.game as Game);\n    } catch (actionError) { setError(actionError instanceof Error ? actionError.message : "Tir impossible."); }''', '''    if (soloActive) {\n      const shot: Shot = { id: `solo-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, shooterId: user.id, power, aim: actualAim, startedAt: Date.now() + 35 };\n      setSoloShot(shot);\n      return;\n    }\n    const shotId = `dunk-${user.id}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;\n    const startedAt = Date.now() + 45;\n    const optimistic: Shot = { id: shotId, shooterId: user.id, power, aim: actualAim, startedAt };\n    setGame((current) => current ? { ...current, shot: optimistic, lastResult: null } : current);\n    try {\n      const data = await post({ action: "shoot", code: room.code, power, aim: actualAim, shotId, startedAt });\n      setGame(data.game as Game);\n    } catch (actionError) {\n      setGame((current) => current?.shot?.id === shotId ? { ...current, shot: null } : current);\n      setError(actionError instanceof Error ? actionError.message : "Tir impossible.");\n    }''')
replace_once('app/DunkshotGame.tsx', '''    const power = clamp((point.y - drag.startY) / 0.30, 0, 1);\n    const aim = clamp((drag.startX - point.x) / 0.24, -1, 1);\n    setAimState({ power, aim });''', '''    const availablePull = Math.max(0.10, Math.min(0.30, 1.02 - drag.startY));\n    const rawPower = clamp((point.y - drag.startY) / availablePull, 0, 1);\n    const atScreenEdge = event.clientY >= window.innerHeight - 20;\n    const power = atScreenEdge && point.y > drag.startY + 0.035 ? 1 : rawPower;\n    const aim = clamp((drag.startX - point.x) / 0.24, -1, 1);\n    setAimState({ power, aim });''')
replace_once('app/DunkshotGame.tsx', '''    setSoloRun(next); soloRunRef.current = next;\n    setSoloShot(null);''', '''    setSoloRun(next); soloRunRef.current = next; resolvedShotsRef.current.clear();\n    setSoloShot(null);''')
replace_once('app/DunkshotGame.tsx', '''      setGame(data.game as Game);\n      setBall(restBall());''', '''      resolvedShotsRef.current.clear(); setGame(data.game as Game);\n      setBall(restBall());''')
# Server-side stale shot auto-resolution.
replace_once('app/api/dunkshot/route.ts', 'const shot: Shot = { id: makeId(), shooterId: user.id, power, aim, startedAt: Date.now() + 280 };', '''const requestedId = String(data.shotId ?? "").trim();\n        const requestedStart = Number(data.startedAt);\n        const now = Date.now();\n        const startedAt = Number.isFinite(requestedStart) ? Math.max(now - 40, Math.min(now + 120, requestedStart)) : now + 55;\n        const shot: Shot = { id: requestedId && requestedId.length <= 120 ? requestedId : makeId(), shooterId: user.id, power, aim, startedAt };''')
# Replace expensive state() with auto-recovery + no cross-game polling.
regex_once('app/api/dunkshot/route.ts', r'''async function state\(code: string\) \{.*?\n\}\n\nexport async function POST''', r'''async function resolveStaleShot(current: Row) {
  const initialShot = parseShot(current.shot);
  if (current.status !== "playing" || !initialShot || Date.now() < initialShot.startedAt + 3000) return current;
  const client = await db().connect();
  try {
    await client.query("begin");
    const result = await client.query<Row>(`select room_code,status,players,lives_total,lives,turn_index,streak,shot,last_result,winner_id,time_limit_sec,started_at,ends_at from retro_dunkshot_games where room_code=$1 for update`, [current.room_code]);
    const locked = result.rows[0];
    const shot = locked ? parseShot(locked.shot) : null;
    if (!locked || locked.status !== "playing" || !shot || shot.id !== initialShot.id || Date.now() < shot.startedAt + 3000) { await client.query("rollback"); return locked ?? current; }
    const players = parsePlayers(locked.players);
    const lives = parseLives(locked.lives);
    const made = dunkshotShotMade(shot, Math.max(0, Number(locked.streak) || 0));
    let streak = Math.max(0, Number(locked.streak) || 0), winnerId: string | null = null;
    if (made) streak += 1;
    else {
      lives[shot.shooterId] = Math.max(0, (lives[shot.shooterId] ?? locked.lives_total) - 1);
      streak = 0;
      if (lives[shot.shooterId] <= 0) winnerId = players.find((player) => player.userId !== shot.shooterId)?.userId ?? null;
    }
    const lastResult: LastResult = { shotId: shot.id, shooterId: shot.shooterId, made, at: Date.now() };
    const nextTurn = players.length ? (Math.max(0, Number(locked.turn_index) || 0) + 1) % players.length : 0;
    await client.query(`update retro_dunkshot_games set lives=$1::jsonb,turn_index=$2,streak=$3,shot=null,last_result=$4::jsonb,winner_id=$5,status=$6,updated_at=now() where room_code=$7`, [JSON.stringify(lives), nextTurn, streak, JSON.stringify(lastResult), winnerId, winnerId ? "gameover" : "playing", locked.room_code]);
    await client.query("commit");
  } catch (error) { try { await client.query("rollback"); } catch {} throw error; }
  finally { client.release(); }
  return await row(current.room_code);
}

async function state(code: string) {
  let current = await resolveStaleShot(await row(code));
  current = await expireTimedGame(current);
  return output(current);
}

export async function POST''', flags=re.S)

# ---------------------------------------------------------------------------
# Other stability/performance bugs found during the sweep.
# ---------------------------------------------------------------------------
# Pool mobile had a visual aspect ratio different from its 2:1 physics world.
replace_once('app/pool.css', '.poolTable{aspect-ratio:1.55/1;min-height:380px;border-radius:20px}', '.poolTable{aspect-ratio:2/1;min-height:0;border-radius:20px}')
regex_once('app/PoolGame.tsx', r'''async function post\(payload: Record<string, unknown>\) \{.*?\n\}''', '''async function post(payload: Record<string, unknown>) {\n  const controller = new AbortController();\n  const timeout = window.setTimeout(() => controller.abort(), 6500);\n  try {\n    const response = await fetch("/api/pool", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload), cache: "no-store", signal: controller.signal });\n    const data = await response.json();\n    if (!response.ok || !data.ok) throw new Error(data.error || "Erreur Billard.");\n    return data;\n  } finally { window.clearTimeout(timeout); }\n}''', flags=re.S)

# Flappy: scoring used to restart its RAF loop on every point.
replace_once('app/FlappyGame.tsx', '  const [best, setBest] = useState(0);', '  const [best, setBest] = useState(0);\n  const scoreRef = useRef(0);')
replace_once('app/FlappyGame.tsx', '    setScore(0);', '    scoreRef.current = 0; setScore(0);')
replace_once('app/FlappyGame.tsx', '  const finish = useCallback(() => { setStatus("gameover"); setBest((current) => Math.max(current, score)); }, [score]);', '  const finish = useCallback(() => { setStatus("gameover"); setBest((current) => Math.max(current, scoreRef.current)); }, []);')
replace_once('app/FlappyGame.tsx', 'if (!pipe.passed && pipe.x < 0.22) { pipe.passed = true; setScore((value) => value + 1); }', 'if (!pipe.passed && pipe.x < 0.22) { pipe.passed = true; scoreRef.current += 1; setScore(scoreRef.current); }')
replace_once('app/FlappyGame.tsx', 'if (birdY.current < birdR || birdY.current > 1 - birdR || hitPipe) { setBest((value) => Math.max(value, score)); setStatus("gameover"); }', 'if (birdY.current < birdR || birdY.current > 1 - birdR || hitPipe) { setBest((value) => Math.max(value, scoreRef.current)); setStatus("gameover"); }')
replace_once('app/FlappyGame.tsx', '  }, [status, score]);', '  }, [status]);')

# TicTacToe: timeout + replay starts a fresh match directly rather than just resetting to lobby.
regex_once('app/TicTacToeGame.tsx', r'''async function post\(payload: Record<string, unknown>\) \{.*?\n\}''', '''async function post(payload: Record<string, unknown>) {\n  const controller = new AbortController();\n  const timeout = window.setTimeout(() => controller.abort(), 5500);\n  try {\n    const response = await fetch("/api/game-room", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload), cache: "no-store", signal: controller.signal });\n    const data = await response.json();\n    if (!response.ok || !data.ok) throw new Error(data.error || "Morpion indisponible.");\n    return data;\n  } finally { window.clearTimeout(timeout); }\n}''', flags=re.S)
replace_once('app/TicTacToeGame.tsx', 'onClick={() => void action("tttReset")}>Nouvelle partie</button>', 'onClick={() => void action("tttStart", { fillBots: game.botO, botDifficulty: game.botDifficulty })}>↻ Rejouer</button>')

# Bot UX: avoid a second aggressive room-state poll and noisy characterData observer.
replace_once('app/BotUXEnhancer.tsx', 'observer.observe(document.body, { childList: true, subtree: true, characterData: true });', 'observer.observe(document.body, { childList: true, subtree: true });')
replace_once('app/BotUXEnhancer.tsx', '    const timer = window.setInterval(refresh, 1000);', '    const onRoomState = (event: Event) => { if (alive) setRoom((event as CustomEvent<RoomState>).detail); };\n    window.addEventListener("retro:room-state", onRoomState as EventListener);\n    const timer = window.setInterval(refresh, 5000);')
replace_once('app/BotUXEnhancer.tsx', '    return () => { alive = false; window.clearInterval(timer); };', '    return () => { alive = false; window.clearInterval(timer); window.removeEventListener("retro:room-state", onRoomState as EventListener); };')

# Room chat polls must recover from a hung request instead of busy=true forever.
regex_once('app/RoomComms.tsx', r'''async function post\(path:string,payload:Record<string,unknown>\)\{.*?\n\}''', '''async function post(path:string,payload:Record<string,unknown>){\n  const controller=new AbortController();const timeout=window.setTimeout(()=>controller.abort(),5000);\n  try{const res=await fetch(path,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload),cache:"no-store",signal:controller.signal});const data=await res.json();if(!res.ok||!data.ok)throw new Error(data.error||"Erreur.");return data}\n  finally{window.clearTimeout(timeout)}\n}''', flags=re.S)

# Hangman UI additions and responsive controls.
with open('app/mini-games.css', 'a', encoding='utf-8') as f:
    f.write(r'''

/* Multiplayer Hangman */
.hangmanLobbySetup{display:grid;grid-template-columns:minmax(0,1fr) auto auto;gap:12px;align-items:end;border:1px solid #293744;background:#0a1016;border-radius:15px;padding:13px}.hangmanLobbySetup>div{display:grid;gap:3px}.hangmanLobbySetup small{font-size:9px;color:var(--muted)}.hangmanLobbySetup label{display:grid;gap:5px}.hangmanLobbySetup label span{font-size:8px;color:var(--muted);font-weight:900;letter-spacing:.1em;text-transform:uppercase}.hangmanLobbySetup select{height:39px;border:1px solid #33404c;border-radius:10px;background:#121920;color:#eef3f6;padding:0 28px 0 10px}.hangmanPlayers{display:flex;gap:6px;flex-wrap:wrap;margin:-4px 0 12px}.hangmanPlayers span{padding:6px 9px;border:1px solid #293744;border-radius:999px;background:#101720;color:#8796a3;font-size:9px;font-weight:850}.hangmanPlayers span.turn{border-color:rgba(143,240,189,.5);background:rgba(143,240,189,.08);color:#aef5cd}.hangmanReveal{text-align:center;margin-top:10px;color:#9aa8b3;font-size:11px}.hangmanReveal strong{color:#fff}.hangmanLastAction{margin-top:10px;text-align:center;padding:8px;border:1px solid #31404b;border-radius:10px;font-size:10px;color:#aab5bd}.hangmanLastAction.correct{border-color:rgba(143,240,189,.32);color:#aef5cd}.hangmanLastAction.wrong{border-color:rgba(255,120,135,.3);color:#ffadb6}.hangmanWordGuess{display:flex;gap:8px;margin-top:12px}.hangmanWordGuess input{flex:1;min-width:0;text-transform:uppercase}.hangmanWrongWords{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-top:10px}.hangmanWrongWords small{font-size:7px;color:#74828e;font-weight:900;letter-spacing:.12em}.hangmanWrongWords span{font-size:9px;padding:4px 7px;border:1px solid rgba(255,110,125,.25);background:rgba(255,90,110,.06);color:#ff9faa;border-radius:999px}
@media(max-width:700px){.hangmanLobbySetup{grid-template-columns:1fr}.hangmanLobbySetup button,.hangmanLobbySetup select{width:100%}.hangmanWordGuess{flex-direction:column}.hangmanWordGuess button{width:100%}}
''')

# Production CI now validates the real Next build as well as TypeScript.
replace_once('.github/workflows/typecheck.yml', '      - run: npm run typecheck\n', '      - run: npm run typecheck\n      - run: npm run build\n')

print('Full site audit patch applied successfully.')
