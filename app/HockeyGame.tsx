"use client";

import { PointerEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

type User={id:string;username:string};
type RoomMember={id:string;username:string;online:boolean;joined_at:string};
type Room={code:string;hostId:string;members:RoomMember[]};
type Mode="1v1"|"2v2";
type Side="left"|"right";
type Player={userId:string;username:string;side:Side;slot:number};
type Paddle={x:number;y:number;vx:number;vy:number};
type Frame={puck:{x:number;y:number;vx:number;vy:number};paddles:Record<string,Paddle>;leftScore:number;rightScore:number;winnerSide:Side|null;pauseUntil:number};
type Game={mode:Mode;status:"lobby"|"playing"|"gameover";players:Player[];leftScore:number;rightScore:number;winnerSide:Side|null;targetScore:number;frame:Frame|null};

const MAX_MALLET=1.35;

async function post(payload:Record<string,unknown>){
  const res=await fetch("/api/hockey",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload),cache:"no-store"});
  const data=await res.json();
  if(!res.ok||!data.ok)throw new Error(data.error||"Erreur.");
  return data;
}

function initial(player:Player,mode:Mode):Paddle{
  return{x:player.side==="left"?.2:.8,y:mode==="1v1"?.5:player.slot===0?.34:.66,vx:0,vy:0};
}

function clampPad(side:Side,x:number,y:number){
  return{x:Math.max(side==="left"?.075:.53,Math.min(side==="left"?.47:.925,x)),y:Math.max(.085,Math.min(.915,y))};
}

export default function HockeyGame({room,user,onActiveChange}:{room:Room;user:User;onActiveChange?:(active:boolean)=>void}){
  const[game,setGame]=useState<Game|null>(null);
  const[error,setError]=useState("");
  const[busy,setBusy]=useState(false);
  const[localPad,setLocalPad]=useState<{x:number;y:number}|null>(null);
  const rinkRef=useRef<HTMLDivElement|null>(null);
  const gameRef=useRef<Game|null>(null);
  const lastInput=useRef({x:.5,y:.5,at:performance.now()});
  const lastSend=useRef(0);
  const queued=useRef<{x:number;y:number;vx:number;vy:number}|null>(null);
  const sending=useRef(false);

  useEffect(()=>{gameRef.current=game},[game]);
  const me=useMemo(()=>game?.players.find(p=>p.userId===user.id)??null,[game,user.id]);
  const left=useMemo(()=>game?.players.filter(p=>p.side==="left")??[],[game]);
  const right=useMemo(()=>game?.players.filter(p=>p.side==="right")??[],[game]);
  const isHost=room.hostId===user.id;
  const needed=game?.mode==="2v2"?4:2;
  const online=room.members.filter(m=>m.online).length;

  const apply=useCallback((next:Game)=>{
    gameRef.current=next;
    setGame(next);
    setError("");
  },[]);

  useEffect(()=>{
    let alive=true,busyPoll=false;
    const poll=async()=>{
      if(!alive||busyPoll)return;
      busyPoll=true;
      try{const data=await post({action:"poll",code:room.code});if(alive)apply(data.game as Game)}
      catch(e){if(alive)setError(e instanceof Error?e.message:"Hockey indisponible.")}
      finally{busyPoll=false}
    };
    void poll();
    const id=window.setInterval(poll,85);
    return()=>{alive=false;window.clearInterval(id)};
  },[room.code,apply]);

  useEffect(()=>{
    const active=game?.status==="playing"||game?.status==="gameover";
    document.body.classList.toggle("hockey-match-active",Boolean(active));
    onActiveChange?.(Boolean(active));
    return()=>{
      document.body.classList.remove("hockey-match-active");
    };
  },[game?.status,onActiveChange]);

  useEffect(()=>{
    if(!me||game?.status!=="playing")return;
    const p=game.frame?.paddles?.[user.id]??initial(me,game.mode);
    lastInput.current={x:p.x,y:p.y,at:performance.now()};
    setLocalPad({x:p.x,y:p.y});
  },[game?.status,me?.userId]);

  const flushInput=useCallback(async()=>{
    if(sending.current||!queued.current)return;
    const packet=queued.current;queued.current=null;sending.current=true;lastSend.current=performance.now();
    try{const data=await post({action:"input",code:room.code,...packet});apply(data.game as Game)}
    catch(e){setError(e instanceof Error?e.message:"Synchronisation impossible.")}
    finally{
      sending.current=false;
      if(queued.current){const delay=Math.max(0,42-(performance.now()-lastSend.current));window.setTimeout(()=>void flushInput(),delay)}
    }
  },[room.code,apply]);

  const sendPosition=useCallback((x:number,y:number)=>{
    const current=gameRef.current;
    const player=current?.players.find(p=>p.userId===user.id);
    if(!current||!player||current.status!=="playing")return;
    const point=clampPad(player.side,x,y);
    const now=performance.now();
    const dt=Math.max(.014,(now-lastInput.current.at)/1000);
    let vx=(point.x-lastInput.current.x)/dt,vy=(point.y-lastInput.current.y)/dt;
    const speed=Math.hypot(vx,vy);if(speed>MAX_MALLET){vx*=MAX_MALLET/speed;vy*=MAX_MALLET/speed}
    lastInput.current={x:point.x,y:point.y,at:now};
    setLocalPad(point);
    queued.current={x:point.x,y:point.y,vx,vy};
    if(!sending.current&&now-lastSend.current>=42)void flushInput();
  },[user.id,flushInput]);

  const point=(event:PointerEvent<HTMLDivElement>)=>{
    const rect=rinkRef.current?.getBoundingClientRect();if(!rect)return;
    if(event.type==="pointerdown")event.currentTarget.setPointerCapture(event.pointerId);
    sendPosition((event.clientX-rect.left)/rect.width,(event.clientY-rect.top)/rect.height);
  };

  const configure=async(mode:Mode)=>{
    try{setBusy(true);apply((await post({action:"configure",code:room.code,mode})).game)}
    catch(e){setError(e instanceof Error?e.message:"Erreur.")}
    finally{setBusy(false)}
  };

  const start=async()=>{
    try{setBusy(true);apply((await post({action:"start",code:room.code})).game)}
    catch(e){setError(e instanceof Error?e.message:"Erreur.")}
    finally{setBusy(false)}
  };

  if(!game)return <section className="hockeyLobby"><div className="spinner"/><p>Chargement du hockey…</p>{error&&<div className="errorBox">{error}</div>}</section>;

  if(game.status==="lobby")return <section className="hockeyLobby">
    <div className="hockeyHero"><div className="hockeyDisc">🏒</div><div><span className="kicker">HOCKEY ARCADE</span><h2>Hockey sur glace</h2><p>Choisis le mode puis lance la partie. Les deux joueurs utilisent exactement le même moteur physique.</p></div></div>
    <div className="modePicker">
      <button className={game.mode==="1v1"?"selected":""} disabled={!isHost||busy} onClick={()=>void configure("1v1")}><strong>1 VS 1</strong><small>2 joueurs</small></button>
      <button className={game.mode==="2v2"?"selected":""} disabled={!isHost||busy} onClick={()=>void configure("2v2")}><strong>2 VS 2</strong><small>4 joueurs</small></button>
    </div>
    <div className="hockeyReadyBar"><span>{online}/{needed} joueurs connectés</span>{isHost?<button className="primaryButton" disabled={busy||online<needed} onClick={()=>void start()}>{busy?"Lancement…":`Lancer le ${game.mode}`}</button>:<small>En attente de l'hôte…</small>}</div>
    {error&&<div className="errorBox">{error}</div>}
  </section>;

  const frame=game.frame??{puck:{x:.5,y:.5,vx:0,vy:0},paddles:Object.fromEntries(game.players.map(p=>[p.userId,initial(p,game.mode)])),leftScore:game.leftScore,rightScore:game.rightScore,winnerSide:game.winnerSide,pauseUntil:0};
  const winners=(frame.winnerSide==="left"?left:right).map(p=>p.username).join(" & ");

  return <section className="hockeyGameWrap">
    <div className="hockeyGameTop">
      <div className="teamNames leftTeam"><small>BLEU</small><strong>{left.map(p=>p.username).join(" · ")}</strong></div>
      <div className="hockeyScore"><b>{frame.leftScore}</b><span>—</span><b>{frame.rightScore}</b></div>
      <div className="teamNames rightTeam"><small>ROUGE</small><strong>{right.map(p=>p.username).join(" · ")}</strong></div>
    </div>
    <div className="rinkFrame"><div ref={rinkRef} className={`hockeyRink ${me?"controllable":"spectating"}`} onPointerDown={point} onPointerMove={e=>{if(e.buttons||e.pointerType==="touch")point(e)}}>
      <div className="rinkCenterLine"/><div className="rinkCenterCircle"/><div className="goal goalLeft"/><div className="goal goalRight"/><div className="goalCrease creaseLeft"/><div className="goalCrease creaseRight"/>
      {game.players.map(player=>{
        const server=frame.paddles[player.userId]??initial(player,game.mode);
        const pad=player.userId===user.id&&localPad?{...server,...localPad}:server;
        return <div key={player.userId} className={`hockeyMallet ${player.side} ${player.userId===user.id?"mine":""}`} style={{left:`${pad.x*100}%`,top:`${pad.y*100}%`}}><span>{player.username.slice(0,2).toUpperCase()}</span></div>;
      })}
      <div className="hockeyPuck" style={{left:`${frame.puck.x*100}%`,top:`${frame.puck.y*100}%`}}/>
      {frame.winnerSide&&<div className="hockeyWinnerOverlay"><span>🏆</span><h2>{winners||"Équipe"} gagne !</h2><p>{frame.leftScore} — {frame.rightScore}</p></div>}
    </div></div>
    {error&&<div className="errorBox hockeyGameError">{error}</div>}
  </section>;
}