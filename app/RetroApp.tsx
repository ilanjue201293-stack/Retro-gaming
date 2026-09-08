"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import RoomComms from "./RoomComms";
import HockeyGame from "./HockeyGame";

type User={id:string;username:string};
type Friend={id:string;username:string;online:boolean};
type Request={id:string;user_id:string;username:string};
type Invite={id:string;room_code:string;sender_name:string;created_at:string};
type SocialState={friends:Friend[];incoming:Request[];outgoing:Request[];roomInvites:Invite[]};
type RoomMember={id:string;username:string;online:boolean;joined_at:string};
type Room={code:string;hostId:string;members:RoomMember[]};

async function post(path:string,payload:Record<string,unknown>){
  const res=await fetch(path,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload),cache:"no-store"});
  const data=await res.json();if(!res.ok||!data.ok)throw new Error(data.error||"Erreur.");return data;
}

const ROOM_KEY="retro-active-room";

export default function RetroApp(){
  const[authLoading,setAuthLoading]=useState(true);
  const[user,setUser]=useState<User|null>(null);
  const[authMode,setAuthMode]=useState<"login"|"register">("login");
  const[authUsername,setAuthUsername]=useState("");
  const[authPassword,setAuthPassword]=useState("");
  const[authBusy,setAuthBusy]=useState(false);
  const[error,setError]=useState("");

  const[social,setSocial]=useState<SocialState>({friends:[],incoming:[],outgoing:[],roomInvites:[]});
  const[friendName,setFriendName]=useState("");
  const[joinCode,setJoinCode]=useState("");
  const[room,setRoom]=useState<Room|null>(null);
  const[roomBusy,setRoomBusy]=useState(false);
  const[toast,setToast]=useState("");

  const me=useCallback(async()=>{
    try{const data=await post("/api/auth",{action:"me"});setUser(data.user??null)}
    catch{setUser(null)}finally{setAuthLoading(false)}
  },[]);
  useEffect(()=>{void me()},[me]);
  useEffect(()=>{if(!toast)return;const id=setTimeout(()=>setToast(""),2800);return()=>clearTimeout(id)},[toast]);

  const refreshSocial=useCallback(async()=>{
    if(!user)return;
    try{
      const data=await post("/api/friends",{action:"state"});
      setSocial({friends:data.friends??[],incoming:data.incoming??[],outgoing:data.outgoing??[],roomInvites:data.roomInvites??[]});
    }catch{}
  },[user]);

  useEffect(()=>{
    if(!user)return;void refreshSocial();
    const id=setInterval(()=>void refreshSocial(),3000);return()=>clearInterval(id);
  },[user,refreshSocial]);

  const refreshRoom=useCallback(async(code:string)=>{
    const data=await post("/api/rooms",{action:"state",code});setRoom(data.room);
  },[]);

  useEffect(()=>{
    if(!user)return;const saved=localStorage.getItem(ROOM_KEY);
    if(!saved||room)return;void refreshRoom(saved).catch(()=>localStorage.removeItem(ROOM_KEY));
  },[user,room,refreshRoom]);

  useEffect(()=>{
    if(!room)return;let alive=true,busy=false;
    const poll=async()=>{
      if(busy||!alive)return;busy=true;
      try{const data=await post("/api/rooms",{action:"state",code:room.code});if(alive)setRoom(data.room)}
      catch(e){const msg=e instanceof Error?e.message:"";if(/introuvable|pas dans cette room/i.test(msg)){localStorage.removeItem(ROOM_KEY);if(alive)setRoom(null)}}
      finally{busy=false}
    };
    const id=setInterval(poll,1000);return()=>{alive=false;clearInterval(id)};
  },[room?.code]);

  const submitAuth=async(e:FormEvent)=>{
    e.preventDefault();
    try{
      setAuthBusy(true);setError("");
      const data=await post("/api/auth",{action:authMode,username:authUsername,password:authPassword});
      setUser(data.user);setAuthPassword("");
    }catch(e){setError(e instanceof Error?e.message:"Erreur.")}
    finally{setAuthBusy(false)}
  };

  const logout=async()=>{
    try{await post("/api/auth",{action:"logout"})}catch{}
    localStorage.removeItem(ROOM_KEY);setUser(null);setRoom(null);setSocial({friends:[],incoming:[],outgoing:[],roomInvites:[]});
  };

  const friendAction=async(action:string,extra:Record<string,unknown>={})=>{
    try{
      setError("");const data=await post("/api/friends",{action,...extra});
      setSocial({friends:data.friends??[],incoming:data.incoming??[],outgoing:data.outgoing??[],roomInvites:data.roomInvites??[]});
      if(action==="request")setFriendName("");
    }catch(e){setError(e instanceof Error?e.message:"Erreur.")}
  };

  const createRoom=async()=>{
    try{
      setRoomBusy(true);setError("");const data=await post("/api/rooms",{action:"create"});
      setRoom(data.room);localStorage.setItem(ROOM_KEY,data.room.code);
    }catch(e){setError(e instanceof Error?e.message:"Erreur.")}
    finally{setRoomBusy(false)}
  };

  const joinRoom=async(codeValue=joinCode)=>{
    try{
      setRoomBusy(true);setError("");const data=await post("/api/rooms",{action:"join",code:codeValue});
      setRoom(data.room);localStorage.setItem(ROOM_KEY,data.room.code);setJoinCode("");
    }catch(e){setError(e instanceof Error?e.message:"Erreur.")}
    finally{setRoomBusy(false)}
  };

  const acceptInvite=async(inviteId:string)=>{
    try{
      setRoomBusy(true);setError("");const data=await post("/api/rooms",{action:"acceptInvite",inviteId});
      setRoom(data.room);localStorage.setItem(ROOM_KEY,data.room.code);
    }catch(e){setError(e instanceof Error?e.message:"Erreur.")}
    finally{setRoomBusy(false)}
  };

  const leaveRoom=async()=>{
    if(!room)return;try{await post("/api/rooms",{action:"leave",code:room.code})}catch{}
    localStorage.removeItem(ROOM_KEY);setRoom(null);
  };

  const inviteFriend=async(friend:Friend)=>{
    if(!room)return;
    try{await post("/api/rooms",{action:"invite",code:room.code,friendId:friend.id});setToast(`Invitation envoyée à ${friend.username}`)}
    catch(e){setError(e instanceof Error?e.message:"Erreur.")}
  };

  if(authLoading)return <main className="centerScreen"><div className="spinner"/><p>Chargement…</p></main>;

  if(!user)return <main className="authPage">
    <section className="authBrand">
      <div className="eyebrow">● MINI-JEUX PRIVÉS ENTRE AMIS</div>
      <h1>RETRO <span>GAMING</span></h1>
      <p>Un seul compte. Tes amis. Vos rooms. Vos jeux.</p>
    </section>
    <section className="authCard">
      <div className="authTabs">
        <button className={authMode==="login"?"active":""} onClick={()=>setAuthMode("login")}>Connexion</button>
        <button className={authMode==="register"?"active":""} onClick={()=>setAuthMode("register")}>Créer un compte</button>
      </div>
      <form onSubmit={submitAuth}>
        <label>Pseudo</label>
        <input value={authUsername} onChange={e=>setAuthUsername(e.target.value)} maxLength={18} autoComplete="username" placeholder="Ton pseudo"/>
        <label>Mot de passe</label>
        <input type="password" value={authPassword} onChange={e=>setAuthPassword(e.target.value)} autoComplete={authMode==="login"?"current-password":"new-password"} placeholder="••••••••"/>
        <button className="primaryButton full" disabled={authBusy}>{authBusy?"Chargement…":authMode==="login"?"Se connecter":"Créer mon compte"}</button>
      </form>
      {error&&<div className="errorBox">{error}</div>}
      <small className="authHint">Pas d'e-mail nécessaire : retiens bien ton pseudo et ton mot de passe.</small>
    </section>
  </main>;

  if(room)return <main className="appShell">
    <header className="topbar">
      <div className="brandSmall">RETRO <span>GAMING</span></div>
      <button className="roomCode" onClick={()=>navigator.clipboard?.writeText(room.code).then(()=>setToast("Code copié"))}><small>ROOM</small><strong>{room.code}</strong><span>⧉</span></button>
      <button className="ghostButton dangerText" onClick={()=>void leaveRoom()}>Quitter</button>
    </header>

    {toast&&<div className="topToast">{toast}</div>}
    {error&&<div className="errorBox topError">{error}</div>}

    <div className="roomLayout">
      <section className="roomMain">
        <div className="roomHeading">
          <div><span className="kicker">ROOM PRIVÉE</span><h2>{room.members.length} membre{room.members.length>1?"s":""}</h2></div>
          <span className="hostPill">{room.hostId===user.id?"Tu es l'hôte":`Hôte : ${room.members.find(m=>m.id===room.hostId)?.username??"?"}`}</span>
        </div>

        <div className="memberGrid">
          {room.members.map(m=><div className="memberCard" key={m.id}>
            <div className="avatar">{m.username.slice(0,1).toUpperCase()}</div>
            <div><strong>{m.username}{m.id===user.id?" (toi)":""}</strong><small>{m.id===room.hostId?"Hôte":m.online?"En ligne":"Hors ligne"}</small></div>
            <span className={`presence ${m.online?"online":""}`}/>
          </div>)}
        </div>

        <HockeyGame room={room} user={user}/>
      </section>

      <aside className="roomSide">
        <section className="panel">
          <div className="panelHead"><strong>Inviter des amis</strong><small>{social.friends.length} ami{social.friends.length>1?"s":""}</small></div>
          <div className="friendInviteList">
            {social.friends.map(f=><div className="friendRow" key={f.id}>
              <span className={`presence ${f.online?"online":""}`}/>
              <div><strong>{f.username}</strong><small>{f.online?"En ligne":"Hors ligne"}</small></div>
              <button onClick={()=>void inviteFriend(f)}>Inviter</button>
            </div>)}
            {!social.friends.length&&<p className="mutedSmall">Ajoute des amis depuis l'accueil pour les inviter plus vite.</p>}
          </div>
        </section>
      </aside>
    </div>

    <RoomComms code={room.code} user={user}/>
  </main>;

  return <main className="appShell">
    <header className="dashboardHeader">
      <div><div className="brandSmall big">RETRO <span>GAMING</span></div><small>Connecté en tant que <strong>{user.username}</strong></small></div>
      <button className="ghostButton" onClick={()=>void logout()}>Déconnexion</button>
    </header>

    {error&&<div className="errorBox topError">{error}</div>}
    {toast&&<div className="topToast">{toast}</div>}

    <section className="welcome">
      <span className="kicker">TABLEAU DE BORD</span>
      <h1>Salut, {user.username} 👋</h1>
      <p>Crée une room, invite tes amis et lance une partie.</p>
    </section>

    <div className="dashboardGrid">
      <section className="dashboardMain">
        <div className="actionGrid">
          <div className="actionCard">
            <span>＋</span><h3>Créer une room</h3><p>Crée un espace privé puis invite tes amis.</p>
            <button className="primaryButton full" disabled={roomBusy} onClick={()=>void createRoom()}>Créer</button>
          </div>
          <div className="actionCard">
            <span>⌁</span><h3>Rejoindre avec un code</h3><p>Entre le code à 5 caractères envoyé par un ami.</p>
            <form onSubmit={e=>{e.preventDefault();void joinRoom()}}>
              <input className="codeInput" value={joinCode} maxLength={5} onChange={e=>setJoinCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g,""))} placeholder="ABCDE"/>
              <button className="secondaryButton" disabled={roomBusy||joinCode.length!==5}>Rejoindre</button>
            </form>
          </div>
        </div>

        <section className="gamesPreview">
          <div className="panelHead"><div><span className="kicker">JEUX</span><h2>Bibliothèque</h2></div><span className="availablePill">1 JEU</span></div>
          <div className="gameLibraryCard">
            <div className="gameLibraryIcon">🏒</div>
            <div><small>ARCADE · MULTIJOUEUR</small><h3>Hockey Arcade</h3><p>Hockey vu du dessus avec palet physique. Joue en 1v1 ou 2v2, au doigt ou à la souris.</p></div>
            <button className="primaryButton" disabled={roomBusy} onClick={()=>void createRoom()}>Créer une room</button>
          </div>
        </section>
      </section>

      <aside className="socialColumn">
        <section className="panel">
          <div className="panelHead"><strong>Amis</strong><small>{social.friends.length}</small></div>
          <form className="addFriend" onSubmit={e=>{e.preventDefault();void friendAction("request",{username:friendName})}}>
            <input value={friendName} onChange={e=>setFriendName(e.target.value)} placeholder="Pseudo exact"/><button>Ajouter</button>
          </form>
          <div className="friendList">
            {social.friends.map(f=><div className="friendRow" key={f.id}>
              <span className={`presence ${f.online?"online":""}`}/>
              <div><strong>{f.username}</strong><small>{f.online?"En ligne":"Hors ligne"}</small></div>
              <button className="tinyDanger" onClick={()=>void friendAction("remove",{friendId:f.id})}>×</button>
            </div>)}
            {!social.friends.length&&<p className="mutedSmall">Aucun ami ajouté.</p>}
          </div>
        </section>

        {social.incoming.length>0&&<section className="panel">
          <div className="panelHead"><strong>Demandes reçues</strong><small>{social.incoming.length}</small></div>
          {social.incoming.map(r=><div className="requestRow" key={r.id}><strong>{r.username}</strong><div><button onClick={()=>void friendAction("accept",{requestId:r.id})}>Accepter</button><button className="decline" onClick={()=>void friendAction("decline",{requestId:r.id})}>Refuser</button></div></div>)}
        </section>}

        {social.outgoing.length>0&&<section className="panel">
          <div className="panelHead"><strong>Demandes envoyées</strong><small>{social.outgoing.length}</small></div>
          {social.outgoing.map(r=><div className="pendingRow" key={r.id}><strong>{r.username}</strong><small>En attente</small></div>)}
        </section>}

        {social.roomInvites.length>0&&<section className="panel invitesPanel">
          <div className="panelHead"><strong>Invitations de room</strong><small>{social.roomInvites.length}</small></div>
          {social.roomInvites.map(i=><div className="inviteCard" key={i.id}><div><strong>{i.sender_name}</strong><small>Room {i.room_code}</small></div><button disabled={roomBusy} onClick={()=>void acceptInvite(i.id)}>Rejoindre</button></div>)}
        </section>}
      </aside>
    </div>
  </main>;
}
