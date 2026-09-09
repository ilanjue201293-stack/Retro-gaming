"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import RoomComms from "./RoomComms";
import HockeyGame from "./HockeyGame";
import PongGame from "./PongGame";
import RpsGame from "./RpsGame";
import DunkshotGame from "./DunkshotGame";
import PoolGame from "./PoolGame";
import { GAME_REGISTRY, GameKey } from "./gameRegistry";

type User = { id: string; username: string };
type Friend = { id: string; username: string; online: boolean };
type Request = { id: string; user_id: string; username: string };
type Invite = { id: string; room_code: string; sender_name: string; created_at: string };
type SocialState = { friends: Friend[]; incoming: Request[]; outgoing: Request[]; roomInvites: Invite[] };
type RoomMember = { id: string; username: string; online: boolean; joined_at: string };
type Room = { code: string; hostId: string; members: RoomMember[] };
type RoomGameKey = GameKey;

async function post(path: string, payload: Record<string, unknown>) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 7000);
  try {
    const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload), cache: "no-store", signal: controller.signal });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || "Erreur.");
    return data;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw new Error("Le serveur met trop de temps à répondre. Réessaie.");
    throw error;
  } finally { window.clearTimeout(timeout); }
}

const ROOM_KEY = "retro-active-room";
const EMPTY_SOCIAL: SocialState = { friends: [], incoming: [], outgoing: [], roomInvites: [] };

export default function RetroApp() {
  const [authLoading, setAuthLoading] = useState(true);
  const [user, setUser] = useState<User | null>(null);
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [authUsername, setAuthUsername] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [error, setError] = useState("");

  const [social, setSocial] = useState<SocialState>(EMPTY_SOCIAL);
  const [friendName, setFriendName] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [room, setRoom] = useState<Room | null>(null);
  const [roomBusy, setRoomBusy] = useState(false);
  const [toast, setToast] = useState("");
  const [hockeyActive, setHockeyActive] = useState(false);
  const [activeGame, setActiveGame] = useState<"hockey" | "pool" | null>(null);
  const [selectedRoomGame, setSelectedRoomGame] = useState<RoomGameKey>("hockey");

  const me = useCallback(async () => {
    try {
      const data = await post("/api/auth", { action: "me" });
      setUser(data.user ?? null);
    } catch {
      setUser(null);
    } finally {
      setAuthLoading(false);
    }
  }, []);

  useEffect(() => { void me(); }, [me]);

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(""), 2800);
    return () => window.clearTimeout(id);
  }, [toast]);

  useEffect(() => {
    const onGameActive = (event: Event) => {
      const detail = (event as CustomEvent<string | null>).detail;
      setActiveGame(detail === "hockey" || detail === "pool" ? detail : null);
    };
    window.addEventListener("retro:game-active", onGameActive as EventListener);
    return () => window.removeEventListener("retro:game-active", onGameActive as EventListener);
  }, []);
  useEffect(() => {
    const onCurrentGame = (event: Event) => {
      const detail = (event as CustomEvent<RoomGameKey>).detail;
      if (!detail) return;
      setSelectedRoomGame(detail);
      if (detail !== "hockey" && detail !== "pool") setActiveGame(null);
    };
    window.addEventListener("retro:current-game", onCurrentGame as EventListener);
    return () => window.removeEventListener("retro:current-game", onCurrentGame as EventListener);
  }, []);

  const refreshSocial = useCallback(async () => {
    if (!user) return;
    try {
      const data = await post("/api/friends", { action: "state" });
      setSocial({
        friends: data.friends ?? [],
        incoming: data.incoming ?? [],
        outgoing: data.outgoing ?? [],
        roomInvites: data.roomInvites ?? [],
      });
    } catch {}
  }, [user]);

  useEffect(() => {
    if (!user) return;
    void refreshSocial();
    const id = window.setInterval(() => void refreshSocial(), activeGame ? 10000 : 4200);
    return () => window.clearInterval(id);
  }, [user, refreshSocial, activeGame]);

  const refreshRoom = useCallback(async (code: string) => {
    const data = await post("/api/rooms", { action: "state", code });
    setRoom(data.room);
  }, []);

  useEffect(() => {
    if (!user) return;
    const saved = localStorage.getItem(ROOM_KEY);
    if (!saved || room) return;
    void refreshRoom(saved).catch(() => localStorage.removeItem(ROOM_KEY));
  }, [user, room, refreshRoom]);

  useEffect(() => {
    if (!room) {
      setHockeyActive(false);
      return;
    }
    let alive = true;
    let busy = false;
    const poll = async () => {
      if (!alive || busy) return;
      busy = true;
      try {
        const data = await post("/api/rooms", { action: "state", code: room.code });
        if (alive) setRoom(data.room);
      } catch (err) {
        const message = err instanceof Error ? err.message : "";
        if (/introuvable|pas dans cette room/i.test(message)) {
          localStorage.removeItem(ROOM_KEY);
          if (alive) {
            setRoom(null);
            setHockeyActive(false);
          }
        }
      } finally {
        busy = false;
      }
    };
    const id = window.setInterval(poll, activeGame ? 3000 : 1500);
    return () => { alive = false; window.clearInterval(id); };
  }, [room?.code, activeGame]);

  const submitAuth = async (event: FormEvent) => {
    event.preventDefault();
    try {
      setAuthBusy(true);
      setError("");
      const data = await post("/api/auth", { action: authMode, username: authUsername, password: authPassword });
      setUser(data.user);
      setAuthPassword("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur.");
    } finally { setAuthBusy(false); }
  };

  const logout = async () => {
    try { await post("/api/auth", { action: "logout" }); } catch {}
    localStorage.removeItem(ROOM_KEY);
    setUser(null);
    setRoom(null);
    setHockeyActive(false);
    setSocial(EMPTY_SOCIAL);
  };

  const friendAction = async (action: string, extra: Record<string, unknown> = {}) => {
    try {
      setError("");
      const data = await post("/api/friends", { action, ...extra });
      setSocial({ friends: data.friends ?? [], incoming: data.incoming ?? [], outgoing: data.outgoing ?? [], roomInvites: data.roomInvites ?? [] });
      if (action === "request") setFriendName("");
    } catch (err) { setError(err instanceof Error ? err.message : "Erreur."); }
  };

  const createRoom = async (game: RoomGameKey = "hockey") => {
    try {
      setRoomBusy(true); setError("");
      const data = await post("/api/rooms", { action: "create" });
      if (game !== "hockey") await post("/api/game-room", { action: "setGame", code: data.room.code, game });
      setSelectedRoomGame(game);
      setRoom(data.room);
      setHockeyActive(false);
      localStorage.setItem(ROOM_KEY, data.room.code);
    } catch (err) { setError(err instanceof Error ? err.message : "Erreur."); }
    finally { setRoomBusy(false); }
  };

  const joinRoom = async (codeValue = joinCode) => {
    try {
      setRoomBusy(true); setError("");
      const data = await post("/api/rooms", { action: "join", code: codeValue });
      setRoom(data.room);
      setHockeyActive(false);
      localStorage.setItem(ROOM_KEY, data.room.code);
      setJoinCode("");
    } catch (err) { setError(err instanceof Error ? err.message : "Erreur."); }
    finally { setRoomBusy(false); }
  };

  const acceptInvite = async (inviteId: string) => {
    try {
      setRoomBusy(true); setError("");
      const data = await post("/api/rooms", { action: "acceptInvite", inviteId });
      setRoom(data.room);
      setHockeyActive(false);
      localStorage.setItem(ROOM_KEY, data.room.code);
    } catch (err) { setError(err instanceof Error ? err.message : "Erreur."); }
    finally { setRoomBusy(false); }
  };

  const leaveRoom = async () => {
    if (!room) return;
    try { await post("/api/rooms", { action: "leave", code: room.code }); } catch {}
    localStorage.removeItem(ROOM_KEY);
    setHockeyActive(false);
    setRoom(null);
  };

  const inviteFriend = async (friend: Friend) => {
    if (!room) return;
    try {
      await post("/api/rooms", { action: "invite", code: room.code, friendId: friend.id });
      setToast(`Invitation envoyée à ${friend.username}`);
    } catch (err) { setError(err instanceof Error ? err.message : "Erreur."); }
  };

  if (authLoading) return <main className="centerScreen"><div className="spinner"/><p>Chargement…</p></main>;

  if (!user) {
    return <main className="authPage">
      <section className="authBrand">
        <div className="eyebrow">● MINI-JEUX PRIVÉS ENTRE AMIS</div>
        <h1>RETRO <span>GAMING</span></h1>
        <p>Un seul compte. Tes amis. Vos rooms. Vos jeux.</p>
      </section>
      <section className="authCard">
        <div className="authTabs">
          <button className={authMode === "login" ? "active" : ""} onClick={() => setAuthMode("login")}>Connexion</button>
          <button className={authMode === "register" ? "active" : ""} onClick={() => setAuthMode("register")}>Créer un compte</button>
        </div>
        <form onSubmit={submitAuth}>
          <label>Pseudo</label>
          <input value={authUsername} onChange={(event) => setAuthUsername(event.target.value)} maxLength={18} autoComplete="username" placeholder="Ton pseudo"/>
          <label>Mot de passe</label>
          <input type="password" value={authPassword} onChange={(event) => setAuthPassword(event.target.value)} autoComplete={authMode === "login" ? "current-password" : "new-password"} placeholder="••••••••"/>
          <button className="primaryButton full" disabled={authBusy}>{authBusy ? "Chargement…" : authMode === "login" ? "Se connecter" : "Créer mon compte"}</button>
        </form>
        {error && <div className="errorBox">{error}</div>}
        <small className="authHint">Pas d'e-mail nécessaire : retiens bien ton pseudo et ton mot de passe.</small>
      </section>
    </main>;
  }

  if (room) {
    return <main className={`appShell ${hockeyActive ? "hockeyFocusShell" : ""}`}>
      {hockeyActive ? (
        <button className="hockeyQuitButton" onClick={() => void leaveRoom()}>Quitter</button>
      ) : (
        <header className="topbar">
          <div className="brandSmall">RETRO <span>GAMING</span></div>
          <button className="roomCode" onClick={() => navigator.clipboard?.writeText(room.code).then(() => setToast("Code copié"))}>
            <small>ROOM</small><strong>{room.code}</strong><span>⧉</span>
          </button>
          <button className="ghostButton returnRoomButton" onClick={() => window.dispatchEvent(new Event("retro:return-room"))}>← Retour à la room</button>
          <button className="ghostButton dangerText" onClick={() => void leaveRoom()}>Quitter</button>
        </header>
      )}
      {toast && !hockeyActive && <div className="topToast">{toast}</div>}
      {error && !hockeyActive && <div className="errorBox topError">{error}</div>}
      {hockeyActive ? (
        <div className="hockeyFocusStage"><HockeyGame room={room} user={user} onActiveChange={setHockeyActive}/></div>
      ) : (
        <div className="roomLayout">
          <section className="roomMain">
            <div className="roomHeading">
              <div><span className="kicker">ROOM PRIVÉE</span><h2>{room.members.length} membre{room.members.length > 1 ? "s" : ""}</h2></div>
              <span className="hostPill">{room.hostId === user.id ? "Tu es l'hôte" : `Hôte : ${room.members.find((member) => member.id === room.hostId)?.username ?? "?"}`}</span>
            </div>
            <div className="memberGrid">
              {room.members.map((member) => <div className="memberCard" key={member.id}>
                <div className="avatar">{member.username.slice(0, 1).toUpperCase()}</div>
                <div><strong>{member.username}{member.id === user.id ? " (toi)" : ""}</strong><small>{member.id === room.hostId ? "Hôte" : member.online ? "En ligne" : "Hors ligne"}</small></div>
                <span className={`presence ${member.online ? "online" : ""}`}/>
              </div>)}
            </div>
            {selectedRoomGame === "hockey" && <HockeyGame room={room} user={user} onActiveChange={setHockeyActive}/>}
            {selectedRoomGame === "pong" && <PongGame room={room} user={user}/>}
            {selectedRoomGame === "rps" && <RpsGame room={room} user={user}/>}
            {selectedRoomGame === "dunkshot" && <DunkshotGame room={room} user={user}/>}
            {selectedRoomGame === "pool" && <PoolGame room={room} user={user}/>}
          </section>
          <aside className="roomSide">
            <section className="panel">
              <div className="panelHead"><strong>Inviter des amis</strong><small>{social.friends.length} ami{social.friends.length > 1 ? "s" : ""}</small></div>
              <div className="friendInviteList">
                {social.friends.map((friend) => <div className="friendRow" key={friend.id}>
                  <span className={`presence ${friend.online ? "online" : ""}`}/>
                  <div><strong>{friend.username}</strong><small>{friend.online ? "En ligne" : "Hors ligne"}</small></div>
                  <button onClick={() => void inviteFriend(friend)}>Inviter</button>
                </div>)}
                {!social.friends.length && <p className="mutedSmall">Ajoute des amis depuis l'accueil pour les inviter plus vite.</p>}
              </div>
            </section>
          </aside>
        </div>
      )}
      <RoomComms code={room.code} user={user} gameActive={Boolean(activeGame)}/>
    </main>;
  }

  return <main className="appShell">
    <header className="dashboardHeader">
      <div><div className="brandSmall big">RETRO <span>GAMING</span></div><small>Connecté en tant que <strong>{user.username}</strong></small></div>
      <button className="ghostButton" onClick={() => void logout()}>Déconnexion</button>
    </header>
    {error && <div className="errorBox topError">{error}</div>}
    {toast && <div className="topToast">{toast}</div>}
    <section className="welcome"><span className="kicker">TABLEAU DE BORD</span><h1>Salut, {user.username} 👋</h1><p>Crée une room, invite tes amis et lance une partie.</p></section>
    <div className="dashboardGrid">
      <section className="dashboardMain">
        <div className="actionGrid">
          <div className="actionCard"><span>＋</span><h3>Créer une room</h3><p>Crée un espace privé puis invite tes amis.</p><button className="primaryButton full" disabled={roomBusy} onClick={() => void createRoom()}>Créer</button></div>
          <div className="actionCard"><span>⌁</span><h3>Rejoindre avec un code</h3><p>Entre le code à 5 caractères envoyé par un ami.</p><form onSubmit={(event) => { event.preventDefault(); void joinRoom(); }}><input className="codeInput" value={joinCode} maxLength={5} onChange={(event) => setJoinCode(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))} placeholder="ABCDE"/><button className="secondaryButton" disabled={roomBusy || joinCode.length !== 5}>Rejoindre</button></form></div>
        </div>
        <section className="gamesPreview">
          <div className="panelHead"><div><span className="kicker">JEUX</span><h2>Bibliothèque</h2></div><span className="availablePill">{GAME_REGISTRY.length} JEUX</span></div>
          {GAME_REGISTRY.map((game) => <div className="gameLibraryCard" data-game-library={game.key} key={game.key}>
            <div className={`gameLibraryIcon ${game.key === "dunkshot" ? "dunkMiniIcon" : game.key === "pool" ? "poolMiniIcon" : ""}`}>{game.icon}</div>
            <div><small>{game.meta}</small><h3>{game.label}</h3><p>{game.description}</p></div>
            <button className="primaryButton" disabled={roomBusy} onClick={() => void createRoom(game.key)}>Créer une room</button>
          </div>)}
        </section>
      </section>
      <aside className="socialColumn">
        <section className="panel">
          <div className="panelHead"><strong>Amis</strong><small>{social.friends.length}</small></div>
          <form className="addFriend" onSubmit={(event) => { event.preventDefault(); void friendAction("request", { username: friendName }); }}><input value={friendName} onChange={(event) => setFriendName(event.target.value)} placeholder="Pseudo exact"/><button>Ajouter</button></form>
          <div className="friendList">{social.friends.map((friend) => <div className="friendRow" key={friend.id}><span className={`presence ${friend.online ? "online" : ""}`}/><div><strong>{friend.username}</strong><small>{friend.online ? "En ligne" : "Hors ligne"}</small></div><button className="tinyDanger" onClick={() => void friendAction("remove", { friendId: friend.id })}>×</button></div>)}{!social.friends.length && <p className="mutedSmall">Aucun ami ajouté.</p>}</div>
        </section>
        {social.incoming.length > 0 && <section className="panel"><div className="panelHead"><strong>Demandes reçues</strong><small>{social.incoming.length}</small></div>{social.incoming.map((request) => <div className="requestRow" key={request.id}><strong>{request.username}</strong><div><button onClick={() => void friendAction("accept", { requestId: request.id })}>Accepter</button><button className="decline" onClick={() => void friendAction("decline", { requestId: request.id })}>Refuser</button></div></div>)}</section>}
        {social.outgoing.length > 0 && <section className="panel"><div className="panelHead"><strong>Demandes envoyées</strong><small>{social.outgoing.length}</small></div>{social.outgoing.map((request) => <div className="pendingRow" key={request.id}><strong>{request.username}</strong><small>En attente</small></div>)}</section>}
        {social.roomInvites.length > 0 && <section className="panel invitesPanel"><div className="panelHead"><strong>Invitations de room</strong><small>{social.roomInvites.length}</small></div>{social.roomInvites.map((invite) => <div className="inviteCard" key={invite.id}><div><strong>{invite.sender_name}</strong><small>Room {invite.room_code}</small></div><button disabled={roomBusy} onClick={() => void acceptInvite(invite.id)}>Rejoindre</button></div>)}</section>}
      </aside>
    </div>
  </main>;
}
