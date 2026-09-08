import { db } from "./db";

export type HockeyMode = "1v1" | "2v2";
type Side = "left" | "right";
type Player = { userId:string; username:string; avatarData?:string|null; side:Side; slot:number };
type Paddle = { x:number; y:number; vx:number; vy:number };
type Frame = { puck:{x:number;y:number;vx:number;vy:number}; paddles:Record<string,Paddle>; leftScore:number; rightScore:number; winnerSide:Side|null; pauseUntil:number };
type Input = Paddle & { at:number };
type Stored = { roster:Player[]; frame:Frame|null; inputs:Record<string,Input>; lastTick:number; targetScore:number; timeLimitSec:number; startedAt:number|null };
type Row = { room_code:string; mode:HockeyMode; status:"lobby"|"playing"|"gameover"; players:unknown; left_score:number; right_score:number; winner_side:Side|null };

const PUCK_R=.024, MALLET_R=.052, LEFT=.03, RIGHT=.97, TOP=.045, BOTTOM=.955, GOAL_MIN=.36, GOAL_MAX=.64, MAX_PUCK=.82, MAX_MALLET=1.25, DEFAULT_TARGET=7;
const clamp=(n:number,min:number,max:number)=>Math.max(min,Math.min(max,n));
const finite=(n:unknown,f=0)=>{const v=Number(n);return Number.isFinite(v)?v:f};
function cap(x:number,y:number,max:number){const s=Math.hypot(x,y);if(!Number.isFinite(s)||s<1e-6)return{x:0,y:0};if(s<=max)return{x,y};const k=max/s;return{x:x*k,y:y*k}}
function initial(p:Player,mode:HockeyMode):Paddle{return{x:p.side==="left"?.2:.8,y:mode==="1v1"?.5:p.slot===0?.34:.66,vx:0,vy:0}}
function clampPad(side:Side,x:number,y:number){return{x:clamp(x,side==="left"?.075:.53,side==="left"?.47:.925),y:clamp(y,.085,.915)}}
function fresh(roster:Player[],mode:HockeyMode,now:number,leftScore=0,rightScore=0,winnerSide:Side|null=null):Frame{return{puck:{x:.5,y:.5,vx:0,vy:0},paddles:Object.fromEntries(roster.map(p=>[p.userId,initial(p,mode)])),leftScore,rightScore,winnerSide,pauseUntil:now+650}}
function emptyStored(targetScore=DEFAULT_TARGET,timeLimitSec=0):Stored{return{roster:[],frame:null,inputs:{},lastTick:Date.now(),targetScore:clamp(Math.round(targetScore)||DEFAULT_TARGET,1,30),timeLimitSec:Math.max(0,Math.round(timeLimitSec)||0),startedAt:null}}
function decode(raw:unknown,row:Row):Stored{
  const now=Date.now();
  if(raw&&typeof raw==="object"&&!Array.isArray(raw)){
    const v=raw as Partial<Stored>;
    if(Array.isArray(v.roster))return{
      roster:v.roster as Player[],
      frame:v.frame&&typeof v.frame==="object"?v.frame as Frame:null,
      inputs:v.inputs&&typeof v.inputs==="object"?v.inputs as Record<string,Input>:{},
      lastTick:finite(v.lastTick,now),
      targetScore:clamp(Math.round(finite(v.targetScore,DEFAULT_TARGET)),1,30),
      timeLimitSec:Math.max(0,Math.round(finite(v.timeLimitSec,0))),
      startedAt:v.startedAt===null?null:finite(v.startedAt,0)||null,
    };
  }
  if(Array.isArray(raw)){
    const roster=raw as Player[];
    return{roster,frame:row.status==="playing"||row.status==="gameover"?fresh(roster,row.mode,now,row.left_score,row.right_score,row.winner_side):null,inputs:{},lastTick:now,targetScore:DEFAULT_TARGET,timeLimitSec:0,startedAt:null};
  }
  return emptyStored();
}
function output(row:Row,s:Stored){const endsAt=s.startedAt&&s.timeLimitSec>0?s.startedAt+s.timeLimitSec*1000:null;return{mode:row.mode,status:row.status,players:s.roster,leftScore:s.frame?.leftScore??Number(row.left_score||0),rightScore:s.frame?.rightScore??Number(row.right_score||0),winnerSide:s.frame?.winnerSide??row.winner_side,targetScore:s.targetScore,timeLimitSec:s.timeLimitSec,startedAt:s.startedAt,endsAt,frame:s.frame}}
function collide(frame:Frame,old:Paddle,pad:Paddle,side:Side){
  const sx=pad.x-old.x,sy=pad.y-old.y,seg=sx*sx+sy*sy;let cx=pad.x,cy=pad.y;
  if(seg>1e-7){const t=clamp(((frame.puck.x-old.x)*sx+(frame.puck.y-old.y)*sy)/seg,0,1);cx=old.x+sx*t;cy=old.y+sy*t}
  let dx=frame.puck.x-cx,dy=frame.puck.y-cy,d=Math.hypot(dx,dy),min=PUCK_R+MALLET_R;if(d>=min)return;if(d<1e-4){dx=side==="left"?1:-1;dy=0;d=1}
  const nx=dx/d,ny=dy/d;frame.puck.x=pad.x+nx*min;frame.puck.y=pad.y+ny*min;
  const rel=(frame.puck.vx-pad.vx)*nx+(frame.puck.vy-pad.vy)*ny;if(rel<0){frame.puck.vx-=1.5*rel*nx;frame.puck.vy-=1.5*rel*ny}
  frame.puck.vx+=pad.vx*.38+nx*.03;frame.puck.vy+=pad.vy*.38+ny*.03;const v=cap(frame.puck.vx,frame.puck.vy,MAX_PUCK);frame.puck.vx=v.x;frame.puck.vy=v.y;
}
function advance(s:Stored,mode:HockeyMode,now:number){
  const frame=s.frame??fresh(s.roster,mode,now),elapsed=clamp(now-finite(s.lastTick,now),0,220);if(elapsed<=0){s.frame=frame;s.lastTick=now;return}
  const steps=clamp(Math.ceil(elapsed/12),1,20),dt=elapsed/steps/1000,targets=new Map<string,Paddle>();
  for(const p of s.roster){const cur=frame.paddles[p.userId]??initial(p,mode),i=s.inputs[p.userId];if(i&&now-finite(i.at)<1600){const q=clampPad(p.side,finite(i.x,cur.x),finite(i.y,cur.y)),v=cap(finite(i.vx),finite(i.vy),MAX_MALLET);targets.set(p.userId,{x:q.x,y:q.y,vx:v.x,vy:v.y})}else targets.set(p.userId,{...cur,vx:0,vy:0})}
  for(let step=0;step<steps;step++){
    const remaining=Math.max(1,steps-step),oldPads:Record<string,Paddle>={};
    for(const p of s.roster){const pad=frame.paddles[p.userId]??initial(p,mode);oldPads[p.userId]={...pad};const t=targets.get(p.userId)??pad,nx=pad.x+(t.x-pad.x)/remaining,ny=pad.y+(t.y-pad.y)/remaining,v=cap((nx-pad.x)/Math.max(dt,.001),(ny-pad.y)/Math.max(dt,.001),MAX_MALLET);pad.x=nx;pad.y=ny;pad.vx=v.x;pad.vy=v.y;frame.paddles[p.userId]=pad}
    if(!frame.winnerSide&&now>=frame.pauseUntil){
      frame.puck.x+=frame.puck.vx*dt;frame.puck.y+=frame.puck.vy*dt;const f=Math.pow(.994,dt*60);frame.puck.vx*=f;frame.puck.vy*=f;
      if(frame.puck.y-PUCK_R<TOP){frame.puck.y=TOP+PUCK_R;frame.puck.vy=Math.abs(frame.puck.vy)*.96}if(frame.puck.y+PUCK_R>BOTTOM){frame.puck.y=BOTTOM-PUCK_R;frame.puck.vy=-Math.abs(frame.puck.vy)*.96}
      const goal=frame.puck.y>GOAL_MIN&&frame.puck.y<GOAL_MAX;if(!goal&&frame.puck.x-PUCK_R<LEFT){frame.puck.x=LEFT+PUCK_R;frame.puck.vx=Math.abs(frame.puck.vx)*.96}if(!goal&&frame.puck.x+PUCK_R>RIGHT){frame.puck.x=RIGHT-PUCK_R;frame.puck.vx=-Math.abs(frame.puck.vx)*.96}
      for(const p of s.roster){const pad=frame.paddles[p.userId];collide(frame,oldPads[p.userId]??pad,pad,p.side)}
      if(goal&&frame.puck.x<-.01){frame.rightScore++;frame.puck={x:.5,y:.5,vx:0,vy:0};frame.pauseUntil=now+700}else if(goal&&frame.puck.x>1.01){frame.leftScore++;frame.puck={x:.5,y:.5,vx:0,vy:0};frame.pauseUntil=now+700}
      if(frame.leftScore>=s.targetScore)frame.winnerSide="left";if(frame.rightScore>=s.targetScore)frame.winnerSide="right";
    }
  }
  s.frame=frame;s.lastTick=now;
}
async function ensureGame(code:string){await db().query(`insert into retro_hockey_games (room_code) values ($1) on conflict (room_code) do nothing`,[code])}
async function row(code:string){await ensureGame(code);const r=await db().query<Row>(`select room_code,mode,status,players,left_score,right_score,winner_side from retro_hockey_games where room_code=$1 limit 1`,[code]);if(!r.rows[0])throw new Error("Partie hockey introuvable.");return r.rows[0]}
async function host(code:string){const r=await db().query<{host_user_id:string}>(`select host_user_id from retro_rooms where code=$1 and expires_at>now() limit 1`,[code]);if(!r.rows[0])throw new Error("Room introuvable ou expirée.");return r.rows[0].host_user_id}

export async function hockeyState(code:string){const r=await row(code);return output(r,decode(r.players,r))}
export async function hockeyConfigure(code:string,userId:string,mode:HockeyMode,targetScore=DEFAULT_TARGET,timeLimitSec=0){
  if(await host(code)!==userId)throw new Error("Seul l'hôte peut modifier les réglages.");
  const allowedTimes=new Set([0,60,120,180,300,600]);
  const safeTime=allowedTimes.has(Math.round(timeLimitSec))?Math.round(timeLimitSec):0;
  const s=emptyStored(clamp(Math.round(targetScore)||DEFAULT_TARGET,1,30),safeTime);
  await ensureGame(code);
  await db().query(`update retro_hockey_games set mode=$1,status='lobby',players=$2::jsonb,left_score=0,right_score=0,winner_side=null,updated_at=now() where room_code=$3`,[mode,JSON.stringify(s),code]);
  return hockeyState(code);
}
export async function hockeyStart(code:string,userId:string){
  if(await host(code)!==userId)throw new Error("Seul l'hôte peut lancer le match.");const r=await row(code),need=r.mode==="2v2"?4:2,current=decode(r.players,r);
  const members=await db().query<{id:string;username:string;avatar_data:string|null}>(`select u.id,u.username,u.avatar_data from retro_room_members m join retro_users u on u.id=m.user_id where m.room_code=$1 and m.last_seen>now()-interval '15 seconds' order by m.joined_at`,[code]);
  if(members.rows.length<need)throw new Error(r.mode==="2v2"?"Il faut 4 joueurs connectés pour le 2v2.":"Il faut 2 joueurs connectés pour le 1v1.");
  const roster:Player[]=members.rows.slice(0,need).map((m,i)=>({userId:m.id,username:m.username,avatarData:m.avatar_data,side:i%2===0?"left":"right",slot:r.mode==="2v2"?Math.floor(i/2):0})),now=Date.now(),frame=fresh(roster,r.mode,now),inputs=Object.fromEntries(roster.map(p=>[p.userId,{...initial(p,r.mode),at:now}])),s:Stored={roster,frame,inputs,lastTick:now,targetScore:current.targetScore,timeLimitSec:current.timeLimitSec,startedAt:now};
  await db().query(`update retro_hockey_games set status='playing',players=$1::jsonb,left_score=0,right_score=0,winner_side=null,updated_at=now() where room_code=$2`,[JSON.stringify(s),code]);return output({...r,status:"playing",players:s,left_score:0,right_score:0,winner_side:null},s);
}
export async function hockeyStop(code:string,userId:string){if(await host(code)!==userId)throw new Error("Seul l'hôte peut arrêter le match.");const r=await row(code),current=decode(r.players,r),s=emptyStored(current.targetScore,current.timeLimitSec);await db().query(`update retro_hockey_games set status='lobby',players=$1::jsonb,left_score=0,right_score=0,winner_side=null,updated_at=now() where room_code=$2`,[JSON.stringify(s),code]);return hockeyState(code)}
export async function hockeySync(code:string,userId:string,input?:Partial<Paddle>){
  const client=await db().connect();
  try{
    await client.query("begin");
    await client.query(`set local lock_timeout='350ms'`);
    const rr=await client.query<Row>(`select room_code,mode,status,players,left_score,right_score,winner_side from retro_hockey_games where room_code=$1 for update`,[code]);
    const r=rr.rows[0];
    if(!r){await client.query("rollback");return hockeyState(code)}
    const s=decode(r.players,r);
    if(r.status!=="playing"){await client.query("commit");return output(r,s)}
    const p=s.roster.find(v=>v.userId===userId);
    if(p&&input?.x!==undefined&&input?.y!==undefined){const q=clampPad(p.side,finite(input.x),finite(input.y)),v=cap(finite(input.vx),finite(input.vy),MAX_MALLET);s.inputs[userId]={x:q.x,y:q.y,vx:v.x,vy:v.y,at:Date.now()}}
    advance(s,r.mode,Date.now());
    r.left_score=s.frame?.leftScore??0;r.right_score=s.frame?.rightScore??0;r.winner_side=s.frame?.winnerSide??null;if(r.winner_side)r.status="gameover";
    await client.query(`update retro_hockey_games set status=$1,players=$2::jsonb,left_score=$3,right_score=$4,winner_side=$5,updated_at=now() where room_code=$6`,[r.status,JSON.stringify(s),r.left_score,r.right_score,r.winner_side,code]);
    await client.query("commit");
    return output(r,s);
  }catch(e:any){
    try{await client.query("rollback")}catch{}
    if(e?.code==="55P03"){
      const r=await db().query<Row>(`select room_code,mode,status,players,left_score,right_score,winner_side from retro_hockey_games where room_code=$1 limit 1`,[code]);
      if(r.rows[0])return output(r.rows[0],decode(r.rows[0].players,r.rows[0]));
    }
    throw e;
  }finally{client.release()}
}
