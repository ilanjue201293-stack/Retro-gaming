import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { cleanup, db, ensureSchema } from "@/lib/db";
import { cleanRoomCode } from "@/lib/utils";
import { requireRoomMember } from "@/lib/room";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Mode = "1v1" | "2v2";
type Side = "left" | "right";
type HockeyPlayer = { userId: string; username: string; side: Side; slot: number };
type Paddle = { x: number; y: number; vx: number; vy: number };
type Frame = { puck:{x:number;y:number;vx:number;vy:number}; paddles:Record<string,Paddle>; leftScore:number; rightScore:number; winnerSide:Side|null; pauseUntil:number };
type Inputs = Record<string, Paddle & { at:number }>;
type Row = { room_code:string; mode:Mode; status:"lobby"|"playing"|"gameover"; players:HockeyPlayer[]; left_score:number; right_score:number; winner_side:Side|null; state:Frame; inputs:Inputs; last_tick_ms:string|number };

const PUCK_R=.024, MALLET_R=.052, LEFT=.03, RIGHT=.97, TOP=.045, BOTTOM=.955, GOAL_MIN=.36, GOAL_MAX=.64, MAX_PUCK=1.12, MAX_MALLET=1.35, TARGET=7;

async function json(req:NextRequest){try{return await req.json()}catch{return {}}}
function clamp(n:number,min:number,max:number){return Math.max(min,Math.min(max,n))}
function cap(x:number,y:number,max:number){const s=Math.hypot(x,y);if(!Number.isFinite(s)||s===0||s<=max)return{x:Number.isFinite(x)?x:0,y:Number.isFinite(y)?y:0};const k=max/s;return{x:x*k,y:y*k}}
function initial(player:HockeyPlayer,mode:Mode):Paddle{return{x:player.side==="left"?.2:.8,y:mode==="1v1"?.5:player.slot===0?.34:.66,vx:0,vy:0}}
function clampPad(side:Side,x:number,y:number){return{x:clamp(Number.isFinite(x)?x:.5,side==="left"?.075:.53,side==="left"?.47:.925),y:clamp(Number.isFinite(y)?y:.5,.085,.915)}}
function fresh(players:HockeyPlayer[],mode:Mode,now:number):Frame{return{puck:{x:.5,y:.5,vx:0,vy:0},paddles:Object.fromEntries(players.map(p=>[p.userId,initial(p,mode)])),leftScore:0,rightScore:0,winnerSide:null,pauseUntil:now+700}}
async function ensureGame(code:string){await db().query(`insert into retro_hockey_games (room_code) values ($1) on conflict (room_code) do nothing`,[code])}
async function host(code:string){const r=await db().query<{host_user_id:string}>(`select host_user_id from retro_rooms where code=$1 and expires_at>now() limit 1`,[code]);if(!r.rows[0])throw new Error("Room introuvable ou expirée.");return r.rows[0].host_user_id}
async function connected(code:string){const r=await db().query<{id:string;username:string}>(`select u.id,u.username from retro_room_members m join retro_users u on u.id=m.user_id where m.room_code=$1 and m.last_seen>now()-interval '15 seconds' order by m.joined_at`,[code]);return r.rows}
function pub(row:Row){return{mode:row.mode,status:row.status,players:Array.isArray(row.players)?row.players:[],leftScore:Number(row.left_score||0),rightScore:Number(row.right_score||0),winnerSide:row.winner_side,targetScore:TARGET,frame:row.state?.puck?row.state:null}}

function collide(frame:Frame,players:HockeyPlayer[]){
  for(const player of players){
    const pad=frame.paddles[player.userId];if(!pad)continue;
    let dx=frame.puck.x-pad.x,dy=frame.puck.y-pad.y,d=Math.hypot(dx,dy);const minD=PUCK_R+MALLET_R;
    if(d>=minD)continue;if(d<.0001){dx=player.side==="left"?1:-1;dy=0;d=1}
    const nx=dx/d,ny=dy/d;frame.puck.x=pad.x+nx*minD;frame.puck.y=pad.y+ny*minD;
    const rel=(frame.puck.vx-pad.vx)*nx+(frame.puck.vy-pad.vy)*ny;
    if(rel<0){frame.puck.vx-=1.55*rel*nx;frame.puck.vy-=1.55*rel*ny}
    frame.puck.vx+=pad.vx*.44+nx*.045;frame.puck.vy+=pad.vy*.44+ny*.045;
    const c=cap(frame.puck.vx,frame.puck.vy,MAX_PUCK);frame.puck.vx=c.x;frame.puck.vy=c.y;
  }
}

function advance(row:Row,now:number){
  const players=Array.isArray(row.players)?row.players:[];const frame:Frame=row.state?.puck?structuredClone(row.state):fresh(players,row.mode,now);const inputs:Inputs=row.inputs&&typeof row.inputs==="object"?row.inputs:{};
  for(const p of players){const i=inputs[p.userId];if(!i)continue;const q=clampPad(p.side,Number(i.x),Number(i.y));const v=cap(Number(i.vx)||0,Number(i.vy)||0,MAX_MALLET);frame.paddles[p.userId]={x:q.x,y:q.y,vx:v.x,vy:v.y}}
  const elapsed=clamp(now-Number(row.last_tick_ms||now),0,120);const steps=Math.max(1,Math.ceil(elapsed/8));const dt=elapsed>0?elapsed/steps/1000:0;
  for(let s=0;s<steps;s++){
    if(!frame.winnerSide&&now>=frame.pauseUntil){
      frame.puck.x+=frame.puck.vx*dt;frame.puck.y+=frame.puck.vy*dt;const friction=Math.pow(.996,dt*60);frame.puck.vx*=friction;frame.puck.vy*=friction;
      if(frame.puck.y-PUCK_R<TOP){frame.puck.y=TOP+PUCK_R;frame.puck.vy=Math.abs(frame.puck.vy)*.98}if(frame.puck.y+PUCK_R>BOTTOM){frame.puck.y=BOTTOM-PUCK_R;frame.puck.vy=-Math.abs(frame.puck.vy)*.98}
      const goal=frame.puck.y>GOAL_MIN&&frame.puck.y<GOAL_MAX;if(!goal&&frame.puck.x-PUCK_R<LEFT){frame.puck.x=LEFT+PUCK_R;frame.puck.vx=Math.abs(frame.puck.vx)*.98}if(!goal&&frame.puck.x+PUCK_R>RIGHT){frame.puck.x=RIGHT-PUCK_R;frame.puck.vx=-Math.abs(frame.puck.vx)*.98}
      collide(frame,players);
      if(goal&&frame.puck.x<-.02){frame.rightScore++;frame.puck={x:.5,y:.5,vx:0,vy:0};frame.pauseUntil=now+800}else if(goal&&frame.puck.x>1.02){frame.leftScore++;frame.puck={x:.5,y:.5,vx:0,vy:0};frame.pauseUntil=now+800}
      if(frame.leftScore>=TARGET)frame.winnerSide="left";if(frame.rightScore>=TARGET)frame.winnerSide="right";
    }else collide(frame,players)
  }
  return frame;
}

async function readAdvance(code:string){
  const client=await db().connect();try{await client.query("begin");const r=await client.query<Row>(`select room_code,mode,status,players,left_score,right_score,winner_side,state,inputs,last_tick_ms from retro_hockey_games where room_code=$1 for update`,[code]);const row=r.rows[0];if(!row)throw new Error("Partie introuvable.");if(row.status==="playing"){const now=Date.now();const frame=advance(row,now);const status=frame.winnerSide?"gameover":"playing";await client.query(`update retro_hockey_games set state=$1::jsonb,left_score=$2,right_score=$3,winner_side=$4,status=$5,last_tick_ms=$6,updated_at=now() where room_code=$7`,[JSON.stringify(frame),frame.leftScore,frame.rightScore,frame.winnerSide,status,now,code]);row.state=frame;row.left_score=frame.leftScore;row.right_score=frame.rightScore;row.winner_side=frame.winnerSide;row.status=status;row.last_tick_ms=now}await client.query("commit");return row}catch(e){await client.query("rollback");throw e}finally{client.release()}}

export async function POST(req:NextRequest){
  try{
    await ensureSchema();await cleanup();const user=await requireUser(req);const data=await json(req);const code=cleanRoomCode(data.code);const action=String(data.action??"state");await requireRoomMember(code,user);await ensureGame(code);
    if(action==="state"||action==="poll")return NextResponse.json({ok:true,game:pub(await readAdvance(code))});
    if(action==="configure"){if(await host(code)!==user.id)throw new Error("Seul l'hôte peut modifier le mode.");const mode:Mode=data.mode==="2v2"?"2v2":"1v1";await db().query(`update retro_hockey_games set mode=$1,status='lobby',players='[]'::jsonb,left_score=0,right_score=0,winner_side=null,state='{}'::jsonb,inputs='{}'::jsonb,last_tick_ms=0,updated_at=now() where room_code=$2`,[mode,code]);return NextResponse.json({ok:true,game:pub(await readAdvance(code))})}
    if(action==="start"){if(await host(code)!==user.id)throw new Error("Seul l'hôte peut lancer le match.");const current=await readAdvance(code);const need=current.mode==="2v2"?4:2;const list=await connected(code);if(list.length<need)throw new Error(current.mode==="2v2"?"Il faut 4 joueurs connectés pour le 2v2.":"Il faut 2 joueurs connectés pour le 1v1.");const players:HockeyPlayer[]=list.slice(0,need).map((m,index)=>({userId:m.id,username:m.username,side:index%2===0?"left":"right",slot:current.mode==="2v2"?Math.floor(index/2):0}));const now=Date.now();const frame=fresh(players,current.mode,now);const inputs:Inputs=Object.fromEntries(players.map(p=>[p.userId,{...initial(p,current.mode),at:now}]));await db().query(`update retro_hockey_games set status='playing',players=$1::jsonb,left_score=0,right_score=0,winner_side=null,state=$2::jsonb,inputs=$3::jsonb,last_tick_ms=$4,updated_at=now() where room_code=$5`,[JSON.stringify(players),JSON.stringify(frame),JSON.stringify(inputs),now,code]);return NextResponse.json({ok:true,game:pub(await readAdvance(code))})}
    if(action==="input"){
      const client=await db().connect();try{await client.query("begin");const r=await client.query<Row>(`select room_code,mode,status,players,left_score,right_score,winner_side,state,inputs,last_tick_ms from retro_hockey_games where room_code=$1 for update`,[code]);const row=r.rows[0];if(!row||row.status!=="playing")throw new Error("Le match n'est pas en cours.");const player=(row.players??[]).find(p=>p.userId===user.id);if(!player)throw new Error("Tu es spectateur de cette partie.");const point=clampPad(player.side,Number(data.x),Number(data.y));const velocity=cap(Number(data.vx)||0,Number(data.vy)||0,MAX_MALLET);const inputs:Inputs=row.inputs&&typeof row.inputs==="object"?row.inputs:{};inputs[user.id]={x:point.x,y:point.y,vx:velocity.x,vy:velocity.y,at:Date.now()};row.inputs=inputs;const now=Date.now();const frame=advance(row,now);const status=frame.winnerSide?"gameover":"playing";await client.query(`update retro_hockey_games set inputs=$1::jsonb,state=$2::jsonb,left_score=$3,right_score=$4,winner_side=$5,status=$6,last_tick_ms=$7,updated_at=now() where room_code=$8`,[JSON.stringify(inputs),JSON.stringify(frame),frame.leftScore,frame.rightScore,frame.winnerSide,status,now,code]);await client.query("commit");row.state=frame;row.left_score=frame.leftScore;row.right_score=frame.rightScore;row.winner_side=frame.winnerSide;row.status=status;return NextResponse.json({ok:true,game:pub(row)})}catch(e){await client.query("rollback");throw e}finally{client.release()}
    }
    if(action==="stop"){if(await host(code)!==user.id)throw new Error("Seul l'hôte peut arrêter le match.");await db().query(`update retro_hockey_games set status='lobby',players='[]'::jsonb,left_score=0,right_score=0,winner_side=null,state='{}'::jsonb,inputs='{}'::jsonb,last_tick_ms=0,updated_at=now() where room_code=$1`,[code]);return NextResponse.json({ok:true,game:pub(await readAdvance(code))})}
    throw new Error("Action inconnue.");
  }catch(error){const message=error instanceof Error?error.message:"Erreur inconnue.";return NextResponse.json({ok:false,error:message==="AUTH_REQUIRED"?"Connexion requise.":message},{status:message==="AUTH_REQUIRED"?401:400})}
}
