"use client";

import { FormEvent, useEffect, useRef, useState } from "react";

type User={id:string;username:string};
type ChatMessage={id:string;userId:string;username:string;text:string;at:number};
type VoiceParticipant={userId:string;username:string;muted:boolean;lastSeen:number};
type VoiceSignal={id:number;senderId:string;targetId:string;kind:"offer"|"answer"|"ice";payload:unknown};
type PeerEntry={pc:RTCPeerConnection;iceQueue:RTCIceCandidateInit[]};

const ICE_SERVERS:RTCIceServer[]=[
  {urls:"stun:stun.l.google.com:19302"},
  {urls:"stun:stun1.l.google.com:19302"}
];

async function post(path:string,payload:Record<string,unknown>){
  const controller=new AbortController();const timeout=window.setTimeout(()=>controller.abort(),5000);
  try{const res=await fetch(path,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload),cache:"no-store",signal:controller.signal});const data=await res.json();if(!res.ok||!data.ok)throw new Error(data.error||"Erreur.");return data}
  finally{window.clearTimeout(timeout)}
}

function RemoteAudio({stream}:{stream:MediaStream}){
  const ref=useRef<HTMLAudioElement|null>(null);
  useEffect(()=>{
    const a=ref.current;if(!a)return;
    a.srcObject=stream;void a.play().catch(()=>undefined);
    return()=>{a.srcObject=null};
  },[stream]);
  return <audio ref={ref} autoPlay playsInline/>;
}

export default function RoomComms({code,user,gameActive=false}:{code:string;user:User;gameActive?:boolean}){
  const[panel,setPanel]=useState<"chat"|"voice"|null>(null);
  const[messages,setMessages]=useState<ChatMessage[]>([]);
  const[draft,setDraft]=useState("");
  const[chatError,setChatError]=useState("");
  const[unread,setUnread]=useState(0);
  const[notice,setNotice]=useState<ChatMessage|null>(null);
  const listRef=useRef<HTMLDivElement|null>(null);
  const panelRef=useRef<typeof panel>(null);
  const lastMessageId=useRef<string|null>(null);
  const initialized=useRef(false);
  const audioCtx=useRef<AudioContext|null>(null);

  const[voiceJoined,setVoiceJoined]=useState(false);
  const[voiceMuted,setVoiceMuted]=useState(false);
  const[voiceBusy,setVoiceBusy]=useState(false);
  const[voiceError,setVoiceError]=useState("");
  const[voiceParticipants,setVoiceParticipants]=useState<VoiceParticipant[]>([]);
  const[remoteStreams,setRemoteStreams]=useState<Record<string,MediaStream>>({});
  const localStream=useRef<MediaStream|null>(null);
  const peers=useRef<Map<string,PeerEntry>>(new Map());
  const cursor=useRef(0);
  const joinedRef=useRef(false);
  const mutedRef=useRef(false);

  useEffect(()=>{panelRef.current=panel;if(panel==="chat"){setUnread(0);setNotice(null)}},[panel]);

  const ping=()=>{
    try{
      let ctx=audioCtx.current;
      if(!ctx){ctx=new AudioContext();audioCtx.current=ctx}
      if(ctx.state==="suspended")void ctx.resume();
      const osc=ctx.createOscillator(),gain=ctx.createGain();
      osc.frequency.value=780;gain.gain.setValueAtTime(.0001,ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(.06,ctx.currentTime+.01);
      gain.gain.exponentialRampToValueAtTime(.0001,ctx.currentTime+.14);
      osc.connect(gain);gain.connect(ctx.destination);osc.start();osc.stop(ctx.currentTime+.15);
    }catch{}
  };

  useEffect(()=>{
    let alive=true,busy=false;
    const poll=async()=>{
      if(!alive||busy)return;busy=true;
      try{
        const data=await post("/api/chat",{action:"state",code});
        if(!alive)return;
        const next=data.messages as ChatMessage[];setMessages(next);setChatError("");
        const last=next.at(-1)?.id??null;
        if(!initialized.current)initialized.current=true;
        else if(last&&last!==lastMessageId.current){
          const idx=lastMessageId.current?next.findIndex(m=>m.id===lastMessageId.current):-1;
          const added=idx>=0?next.slice(idx+1):[next[next.length-1]];
          const others=added.filter(m=>m.userId!==user.id);
          if(others.length&&panelRef.current!=="chat"){
            const newest=others[others.length-1];setUnread(v=>Math.min(99,v+others.length));setNotice(newest);ping();
            if(document.hidden&&"Notification"in window&&Notification.permission==="granted"){
              try{new Notification(`${newest.username} · Retro Gaming`,{body:newest.text})}catch{}
            }
          }
        }
        lastMessageId.current=last;
      }catch(e){if(alive)setChatError(e instanceof Error?e.message:"Chat indisponible.")}
      finally{busy=false}
    };
    void poll();const id=setInterval(poll,gameActive?2500:1000);return()=>{alive=false;clearInterval(id)};
  },[code,user.id,gameActive]);

  useEffect(()=>{if(panel==="chat"&&listRef.current)listRef.current.scrollTop=listRef.current.scrollHeight},[panel,messages.length]);

  const send=async(e:FormEvent)=>{
    e.preventDefault();const text=draft.trim();if(!text)return;
    try{
      const data=await post("/api/chat",{action:"send",code,message:text});
      setMessages(data.messages);setDraft("");setUnread(0);lastMessageId.current=data.messages.at(-1)?.id??null;
    }catch(e){setChatError(e instanceof Error?e.message:"Envoi impossible.")}
  };

  const closePeer=(id:string)=>{
    const entry=peers.current.get(id);
    if(entry){entry.pc.onicecandidate=null;entry.pc.ontrack=null;entry.pc.close();peers.current.delete(id)}
    setRemoteStreams(curr=>{if(!curr[id])return curr;const next={...curr};delete next[id];return next});
  };

  const sendSignal=async(targetId:string,kind:VoiceSignal["kind"],payload:unknown)=>{
    if(joinedRef.current)await post("/api/voice",{action:"signal",code,targetId,kind,payload});
  };

  const flushIce=async(entry:PeerEntry)=>{
    if(!entry.pc.remoteDescription)return;
    for(const ice of entry.iceQueue.splice(0)){try{await entry.pc.addIceCandidate(ice)}catch{}}
  };

  const ensurePeer=async(otherId:string,initiator:boolean):Promise<PeerEntry|null>=>{
    if(!joinedRef.current||!localStream.current||otherId===user.id)return null;
    const old=peers.current.get(otherId);if(old)return old;
    const pc=new RTCPeerConnection({iceServers:ICE_SERVERS});
    const entry:PeerEntry={pc,iceQueue:[]};peers.current.set(otherId,entry);
    for(const track of localStream.current.getAudioTracks())pc.addTrack(track,localStream.current);
    pc.onicecandidate=e=>{if(e.candidate)void sendSignal(otherId,"ice",e.candidate.toJSON()).catch(()=>undefined)};
    pc.ontrack=e=>{const stream=e.streams[0]??new MediaStream([e.track]);setRemoteStreams(curr=>({...curr,[otherId]:stream}))};
    pc.onconnectionstatechange=()=>{if(pc.connectionState==="failed"||pc.connectionState==="closed")closePeer(otherId)};
    if(initiator){
      try{const offer=await pc.createOffer();await pc.setLocalDescription(offer);await sendSignal(otherId,"offer",offer)}
      catch{closePeer(otherId);return null}
    }
    return entry;
  };

  const handleSignal=async(signal:VoiceSignal)=>{
    if(signal.senderId===user.id)return;
    if(signal.kind==="offer"){
      const entry=await ensurePeer(signal.senderId,false);if(!entry)return;
      try{
        if(entry.pc.signalingState==="have-local-offer")await entry.pc.setLocalDescription({type:"rollback"});
        await entry.pc.setRemoteDescription(signal.payload as RTCSessionDescriptionInit);
        await flushIce(entry);
        const answer=await entry.pc.createAnswer();await entry.pc.setLocalDescription(answer);await sendSignal(signal.senderId,"answer",answer);
      }catch{closePeer(signal.senderId)}
      return;
    }
    const entry=peers.current.get(signal.senderId)??await ensurePeer(signal.senderId,false);if(!entry)return;
    if(signal.kind==="answer"){
      try{if(entry.pc.signalingState==="have-local-offer"){await entry.pc.setRemoteDescription(signal.payload as RTCSessionDescriptionInit);await flushIce(entry)}}catch{closePeer(signal.senderId)}
    }else{
      const ice=signal.payload as RTCIceCandidateInit;
      if(entry.pc.remoteDescription){try{await entry.pc.addIceCandidate(ice)}catch{}}else entry.iceQueue.push(ice);
    }
  };

  const syncPeers=async(people:VoiceParticipant[])=>{
    const active=new Set(people.filter(p=>p.userId!==user.id).map(p=>p.userId));
    for(const id of [...peers.current.keys()])if(!active.has(id))closePeer(id);
    for(const p of people){
      if(p.userId===user.id||peers.current.has(p.userId))continue;
      if(user.id.localeCompare(p.userId)<0)await ensurePeer(p.userId,true);
    }
  };

  const joinVoice=async()=>{
    if(voiceJoined||voiceBusy){setPanel("voice");return}
    try{
      setVoiceBusy(true);setVoiceError("");
      if(!navigator.mediaDevices?.getUserMedia)throw new Error("Micro non disponible sur ce navigateur.");
      const stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true},video:false});
      localStream.current=stream;
      const data=await post("/api/voice",{action:"join",code,muted:false});
      cursor.current=Number(data.cursor??0);setVoiceParticipants(data.participants??[]);
      joinedRef.current=true;mutedRef.current=false;setVoiceJoined(true);setVoiceMuted(false);setPanel("voice");
    }catch(e){
      localStream.current?.getTracks().forEach(t=>t.stop());localStream.current=null;
      setVoiceError(e instanceof Error?e.message:"Connexion vocale impossible.");setPanel("voice");
    }finally{setVoiceBusy(false)}
  };

  const leaveVoice=async()=>{
    try{if(joinedRef.current)await post("/api/voice",{action:"leave",code})}catch{}
    localStream.current?.getTracks().forEach(t=>t.stop());localStream.current=null;
    for(const id of [...peers.current.keys()])closePeer(id);
    joinedRef.current=false;mutedRef.current=false;setVoiceJoined(false);setVoiceMuted(false);setVoiceParticipants([]);cursor.current=0;
  };

  const toggleMute=()=>{
    const next=!mutedRef.current;mutedRef.current=next;setVoiceMuted(next);
    localStream.current?.getAudioTracks().forEach(t=>{t.enabled=!next});
  };

  useEffect(()=>{
    if(!voiceJoined)return;
    let alive=true,busy=false;
    const poll=async()=>{
      if(!alive||busy||!joinedRef.current)return;busy=true;
      try{
        const data=await post("/api/voice",{action:"poll",code,after:cursor.current,muted:mutedRef.current});
        if(!alive)return;
        const people=data.participants as VoiceParticipant[],signals=data.signals as VoiceSignal[];
        cursor.current=Number(data.cursor??cursor.current);setVoiceParticipants(people);setVoiceError("");
        for(const s of signals)await handleSignal(s);await syncPeers(people);
      }catch(e){if(alive)setVoiceError(e instanceof Error?e.message:"Vocal instable.")}
      finally{busy=false}
    };
    void poll();const id=setInterval(poll,800);return()=>{alive=false;clearInterval(id)};
  },[voiceJoined,code]);

  useEffect(()=>{
    if(voiceJoined)return;let alive=true;
    const poll=async()=>{try{const data=await post("/api/voice",{action:"state",code});if(alive)setVoiceParticipants(data.participants??[])}catch{}};
    void poll();const id=setInterval(poll,gameActive?5000:2000);return()=>{alive=false;clearInterval(id)};
  },[voiceJoined,code,gameActive]);

  useEffect(()=>()=>{void leaveVoice()},[code]);

  const askNotif=()=>{
    if("Notification"in window&&Notification.permission==="default")void Notification.requestPermission().catch(()=>undefined);
  };

  return <div className="commsRoot">
    {notice&&panel!=="chat"&&<button className="messageToast" onClick={()=>{setPanel("chat");setNotice(null);setUnread(0)}}><span>💬</span><div><strong>{notice.username}</strong><small>{notice.text}</small></div></button>}

    {panel==="chat"&&<section className="commsPanel">
      <div className="commsHead"><div><strong>Chat de la room</strong><small>Tout le monde peut écrire</small></div><button onClick={()=>setPanel(null)}>×</button></div>
      <div className="chatMessages" ref={listRef}>
        {!messages.length&&<div className="emptyChat">Aucun message pour l'instant.</div>}
        {messages.map(m=>{
          const own=m.userId===user.id;
          return <div key={m.id} className={`chatBubble ${own?"own":""}`}><div><strong>{own?"Toi":m.username}</strong><span>{new Date(m.at).toLocaleTimeString("fr-FR",{hour:"2-digit",minute:"2-digit"})}</span></div><p>{m.text}</p></div>
        })}
      </div>
      <form className="chatForm" onSubmit={send}><input value={draft} onChange={e=>setDraft(e.target.value)} maxLength={240} placeholder="Écris un message…"/><button>Envoyer</button></form>
      {chatError&&<div className="inlineError">{chatError}</div>}
    </section>}

    {panel==="voice"&&<section className="commsPanel voicePanel">
      <div className="commsHead"><div><strong>Appel de groupe</strong><small>{voiceParticipants.length} dans le vocal</small></div><button onClick={()=>setPanel(null)}>×</button></div>
      <div className="voiceBody">
        <div className={`voiceOrb ${voiceJoined?"joined":""}`}>{voiceJoined?"🎙":"☎"}</div>
        <h3>{voiceJoined?"Tu es dans l'appel":"Rejoins tes amis"}</h3>
        <div className="voicePeople">
          {voiceParticipants.map(p=><div className="voicePerson" key={p.userId}><span>{p.username.slice(0,1).toUpperCase()}</span><div><strong>{p.userId===user.id?"Toi":p.username}</strong><small>{p.muted?"Micro coupé":"Micro activé"}</small></div><b>{p.muted?"🔇":"🎙"}</b></div>)}
          {!voiceParticipants.length&&<div className="emptyChat">Personne dans le vocal.</div>}
        </div>
        {!voiceJoined
          ?<button className="primaryButton" disabled={voiceBusy} onClick={()=>void joinVoice()}>{voiceBusy?"Connexion…":"Rejoindre l'appel"}</button>
          :<div className="voiceActions"><button className="secondaryButton" onClick={toggleMute}>{voiceMuted?"🔇 Réactiver":"🎙 Couper le micro"}</button><button className="dangerButton" onClick={()=>void leaveVoice()}>Quitter l'appel</button></div>}
        {voiceError&&<div className="inlineError">{voiceError}</div>}
      </div>
    </section>}

    <div className="commsButtons">
      <button className={voiceJoined?"inCall":""} onClick={()=>voiceJoined?setPanel(panel==="voice"?null:"voice"):void joinVoice()}><span>{voiceMuted?"🔇":"🎙"}</span><span>Vocal</span>{voiceParticipants.length>0&&<b>{voiceParticipants.length}</b>}</button>
      <button onClick={()=>{setPanel(panel==="chat"?null:"chat");setUnread(0);setNotice(null);askNotif()}}><span>💬</span><span>Chat</span>{unread>0&&<b>{unread>9?"9+":unread}</b>}</button>
    </div>

    <div className="audioSinks">{Object.entries(remoteStreams).map(([id,stream])=><RemoteAudio key={id} stream={stream}/>)}</div>
  </div>;
}
