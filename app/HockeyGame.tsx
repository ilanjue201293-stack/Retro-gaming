"use client";

import { PointerEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

type User = { id:string; username:string };
type RoomMember = { id:string; username:string; online:boolean; joined_at:string };
type Room = { code:string; hostId:string; members:RoomMember[] };
type Mode = "1v1" | "2v2";
type Side = "left" | "right";
type Player = { userId:string; username:string; side:Side; slot:number };
type Paddle = { x:number; y:number; vx:number; vy:number };
type Frame = { puck:{x:number;y:number;vx:number;vy:number}; paddles:Record<string,Paddle>; leftScore:number; rightScore:number; winnerSide:Side|null; pauseUntil:number };
type Game = { mode:Mode; status:"lobby"|"playing"|"gameover"; players:Player[]; leftScore:number; rightScore:number; winnerSide:Side|null; targetScore:number; frame:Frame|null };
type LocalInput = { x:number; y:number; vx:number; vy:number };

const MAX_MALLET=1.25;
const clamp=(n:number,min:number,max:number)=>Math.max(min,Math.min(max,n));
const mix=(a:number,b:number,t:number)=>a+(b-a)*t;

async function post(payload:Record<string,unknown>){
  const controller=new AbortController();
  const timeout=window.setTimeout(()=>controller.abort(),2800);
  try{
    const res=await fetch("/api/rooms",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload),cache:"no-store",signal:controller.signal});
    const data=await res.json();
    if(!res.ok||!data.ok)throw new Error(data.error||"Erreur.");
    return data;
  }catch(error){
    if(error instanceof DOMException&&error.name==="AbortError")throw new Error("La synchronisation du hockey est trop lente.");
    throw error;
  }finally{window.clearTimeout(timeout)}
}

function initial(player:Player,mode:Mode):Paddle{return{x:player.side==="left"?.2:.8,y:mode==="1v1"?.5:player.slot===0?.34:.66,vx:0,vy:0}}
function clampPad(side:Side,x:number,y:number){return{x:clamp(x,side==="left"?.075:.53,side==="left"?.47:.925),y:clamp(y,.085,.915)}}
function copyFrame(frame:Frame):Frame{return{puck:{...frame.puck},paddles:Object.fromEntries(Object.entries(frame.paddles).map(([id,p])=>[id,{...p}])),leftScore:frame.leftScore,rightScore:frame.rightScore,winnerSide:frame.winnerSide,pauseUntil:frame.pauseUntil}}

function predictedPuck(source:Frame["puck"],seconds:number,pauseUntil:number){
  if(Date.now()<pauseUntil)return{...source};
  const dt=Math.min(seconds,.18);
  let x=source.x+source.vx*dt;
  let y=source.y+source.vy*dt;
  let vx=source.vx,vy=source.vy;
  const minY=.069,maxY=.931,minX=.054,maxX=.946;
  if(y<minY){y=minY+(minY-y);vy=Math.abs(vy)}else if(y>maxY){y=maxY-(y-maxY);vy=-Math.abs(vy)}
  const goal=y>.36&&y<.64;
  if(!goal){
    if(x<minX){x=minX+(minX-x);vx=Math.abs(vx)}else if(x>maxX){x=maxX-(x-maxX);vx=-Math.abs(vx)}
  }
  return{x:clamp(x,-.04,1.04),y:clamp(y,.045,.955),vx,vy};
}

export default function HockeyGame({room,user}:{room:Room;user:User;onActiveChange?:(active:boolean)=>void}){
  const[game,setGame]=useState<Game|null>(null);
  const[error,setError]=useState("");
  const[busy,setBusy]=useState(false);
  const[visualFrame,setVisualFrame]=useState<Frame|null>(null);
  const rinkRef=useRef<HTMLDivElement|null>(null);
  const gameRef=useRef<Game|null>(null);
  const inputRef=useRef<LocalInput|null>(null);
  const localPadRef=useRef<{x:number;y:number}|null>(null);
  const lastInputRef=useRef({x:.5,y:.5,at:Date.now()});
  const snapshotRef=useRef<{frame:Frame;receivedAt:number}|null>(null);
  const visualRef=useRef<Frame|null>(null);

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
    if(next.frame){
      snapshotRef.current={frame:copyFrame(next.frame),receivedAt:performance.now()};
      if(!visualRef.current){
        const first=copyFrame(next.frame);
        visualRef.current=first;
        setVisualFrame(first);
      }
    }else{
      snapshotRef.current=null;
      visualRef.current=null;
      setVisualFrame(null);
    }
  },[]);

  useEffect(()=>{
    let alive=true;
    let timer:number|undefined;
    const sync=async()=>{
      if(!alive)return;
      try{
        const current=gameRef.current;
        const player=current?.players.find(p=>p.userId===user.id);
        const action=current?.status==="playing"?"hockeySync":"hockeyState";
        const packet:Record<string,unknown>={action,code:room.code};
        if(action==="hockeySync"&&player&&inputRef.current)Object.assign(packet,inputRef.current);
        const data=await post(packet);
        if(alive)apply(data.game as Game);
      }catch(e){if(alive)setError(e instanceof Error?e.message:"Hockey indisponible.")}
      finally{
        if(alive){
          const playing=gameRef.current?.status==="playing";
          timer=window.setTimeout(()=>void sync(),playing?35:280);
        }
      }
    };
    void sync();
    return()=>{alive=false;if(timer!==undefined)window.clearTimeout(timer)};
  },[room.code,user.id,apply]);

  useEffect(()=>{
    const active=game?.status==="playing"||game?.status==="gameover";
    document.body.classList.toggle("hockey-match-active",Boolean(active));
    return()=>document.body.classList.remove("hockey-match-active");
  },[game?.status]);

  useEffect(()=>{
    if(!me||game?.status!=="playing"){
      inputRef.current=null;
      localPadRef.current=null;
      return;
    }
    const p=game.frame?.paddles?.[user.id]??initial(me,game.mode);
    inputRef.current={x:p.x,y:p.y,vx:0,vy:0};
    localPadRef.current={x:p.x,y:p.y};
    lastInputRef.current={x:p.x,y:p.y,at:Date.now()};
  },[game?.status,me?.userId,user.id]);

  useEffect(()=>{
    let raf=0;
    let previous=performance.now();
    const draw=(now:number)=>{
      const current=gameRef.current;
      const snap=snapshotRef.current;
      if(current?.status&&current.status!=="lobby"&&snap?.frame){
        const age=(now-snap.receivedAt)/1000;
        const base=snap.frame;
        const target=copyFrame(base);
        target.puck=predictedPuck(base.puck,age,base.pauseUntil);
        for(const player of current.players){
          const server=base.paddles[player.userId]??initial(player,current.mode);
          if(player.userId===user.id&&localPadRef.current){
            target.paddles[player.userId]={...server,...localPadRef.current};
          }else{
            const dt=Math.min(age,.11);
            const q=clampPad(player.side,server.x+server.vx*dt,server.y+server.vy*dt);
            target.paddles[player.userId]={...server,x:q.x,y:q.y};
          }
        }
        const prev=visualRef.current??target;
        const frameScale=Math.min(3,Math.max(.25,(now-previous)/16.67));
        const puckAlpha=1-Math.pow(.70,frameScale);
        const padAlpha=1-Math.pow(.62,frameScale);
        const next=copyFrame(target);
        next.puck={...target.puck,x:mix(prev.puck.x,target.puck.x,puckAlpha),y:mix(prev.puck.y,target.puck.y,puckAlpha)};
        for(const player of current.players){
          const t=target.paddles[player.userId];
          const p=prev.paddles[player.userId]??t;
          if(player.userId===user.id&&localPadRef.current)next.paddles[player.userId]={...t,x:localPadRef.current.x,y:localPadRef.current.y};
          else next.paddles[player.userId]={...t,x:mix(p.x,t.x,padAlpha),y:mix(p.y,t.y,padAlpha)};
        }
        visualRef.current=next;
        setVisualFrame(next);
      }
      previous=now;
      raf=requestAnimationFrame(draw);
    };
    raf=requestAnimationFrame(draw);
    return()=>cancelAnimationFrame(raf);
  },[user.id]);

  const sendPosition=useCallback((x:number,y:number)=>{
    const current=gameRef.current;
    const player=current?.players.find(p=>p.userId===user.id);
    if(!current||!player||current.status!=="playing")return;
    const point=clampPad(player.side,x,y);
    const now=Date.now();
    const dt=Math.max(.018,(now-lastInputRef.current.at)/1000);
    let vx=(point.x-lastInputRef.current.x)/dt,vy=(point.y-lastInputRef.current.y)/dt;
    const speed=Math.hypot(vx,vy);
    if(speed>MAX_MALLET){vx*=MAX_MALLET/speed;vy*=MAX_MALLET/speed}
    lastInputRef.current={x:point.x,y:point.y,at:now};
    localPadRef.current=point;
    inputRef.current={x:point.x,y:point.y,vx,vy};
  },[user.id]);

  const pointer=(event:PointerEvent<HTMLDivElement>)=>{
    const rect=rinkRef.current?.getBoundingClientRect();if(!rect)return;
    if(event.type==="pointerdown")event.currentTarget.setPointerCapture(event.pointerId);
    sendPosition((event.clientX-rect.left)/rect.width,(event.clientY-rect.top)/rect.height);
  };

  const configure=async(mode:Mode)=>{
    try{setBusy(true);apply((await post({action:"hockeyConfigure",code:room.code,mode})).game as Game)}
    catch(e){setError(e instanceof Error?e.message:"Erreur.")}
    finally{setBusy(false)}
  };
  const start=async()=>{
    try{setBusy(true);apply((await post({action:"hockeyStart",code:room.code})).game as Game)}
    catch(e){setError(e instanceof Error?e.message:"Erreur.")}
    finally{setBusy(false)}
  };

  if(!game)return <section className="hockeyLobby"><div className="spinner"/><p>Chargement du hockey…</p>{error&&<div className="errorBox">{error}</div>}</section>;

  if(game.status==="lobby")return <section className="hockeyLobby">
    <div className="hockeyHero"><div className="hockeyDisc">🏒</div><div><span className="kicker">HOCKEY ARCADE</span><h2>Hockey sur glace</h2><p>Choisis le mode puis lance la partie.</p></div></div>
    <div className="modePicker">
      <button className={game.mode==="1v1"?"selected":""} disabled={!isHost||busy} onClick={()=>void configure("1v1")}><strong>1 VS 1</strong><small>2 joueurs</small></button>
      <button className={game.mode==="2v2"?"selected":""} disabled={!isHost||busy} onClick={()=>void configure("2v2")}><strong>2 VS 2</strong><small>4 joueurs</small></button>
    </div>
    <div className="hockeyReadyBar"><span>{online}/{needed} joueurs connectés</span>{isHost?<button className="primaryButton" disabled={busy||online<needed} onClick={()=>void start()}>{busy?"Lancement…":`Lancer le ${game.mode}`}</button>:<small>En attente de l'hôte…</small>}</div>
    {error&&<div className="errorBox">{error}</div>}
  </section>;

  const fallback:Frame={puck:{x:.5,y:.5,vx:0,vy:0},paddles:Object.fromEntries(game.players.map(p=>[p.userId,initial(p,game.mode)])),leftScore:game.leftScore,rightScore:game.rightScore,winnerSide:game.winnerSide,pauseUntil:0};
  const frame=visualFrame??game.frame??fallback;
  const winners=(frame.winnerSide==="left"?left:right).map(p=>p.username).join(" & ");

  return <section className="hockeyGameWrap hockeyGameLive">
    <div className="hockeyGameTop hockeyScoreOnly">
      <div className="teamNames leftTeam"><small>BLEU</small><strong>{left.map(p=>p.username).join(" · ")}</strong></div>
      <div className="hockeyScore"><b>{frame.leftScore}</b><span>—</span><b>{frame.rightScore}</b></div>
      <div className="teamNames rightTeam"><small>ROUGE</small><strong>{right.map(p=>p.username).join(" · ")}</strong></div>
    </div>
    <div className="rinkFrame hockeyLiveRinkFrame"><div ref={rinkRef} className={`hockeyRink ${me?"controllable":"spectating"}`} onPointerDown={pointer} onPointerMove={e=>{if(e.buttons||e.pointerType==="touch")pointer(e)}}>
      <div className="rinkCenterLine"/><div className="rinkCenterCircle"/><div className="goal goalLeft"/><div className="goal goalRight"/><div className="goalCrease creaseLeft"/><div className="goalCrease creaseRight"/>
      {game.players.map(player=>{const pad=frame.paddles[player.userId]??initial(player,game.mode);return <div key={player.userId} className={`hockeyMallet ${player.side} ${player.userId===user.id?"mine":""}`} style={{left:`${pad.x*100}%`,top:`${pad.y*100}%`,transition:"none"}}><span>{player.username.slice(0,2).toUpperCase()}</span></div>})}
      <div className="hockeyPuck" style={{left:`${frame.puck.x*100}%`,top:`${frame.puck.y*100}%`,transition:"none"}}/>
      {frame.winnerSide&&<div className="hockeyWinnerOverlay"><span>🏆</span><h2>{winners||"Équipe"} gagne !</h2><p>{frame.leftScore} — {frame.rightScore}</p></div>}
    </div></div>
    {error&&<div className="errorBox hockeyGameError">{error}</div>}
  </section>;
}
