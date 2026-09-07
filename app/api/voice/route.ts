import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { cleanup, db, ensureSchema } from "@/lib/db";
import { cleanRoomCode } from "@/lib/utils";
import { requireRoomMember } from "@/lib/room";

export const runtime="nodejs";
export const dynamic="force-dynamic";
async function payload(req:NextRequest){try{return await req.json()}catch{return {}}}

async function participants(code:string){
  const r=await db().query<{user_id:string;username:string;muted:boolean;at:string}>(
    `select user_id,username,muted,round(extract(epoch from last_seen)*1000)::bigint as at
     from retro_voice_participants where room_code=$1 and last_seen>now()-interval '15 seconds' order by username`,[code]
  );
  return r.rows.map(x=>({userId:x.user_id,username:x.username,muted:x.muted,lastSeen:Number(x.at)}));
}

export async function POST(req:NextRequest){
  try{
    await ensureSchema();await cleanup();
    const user=await requireUser(req);
    const data=await payload(req);
    const code=cleanRoomCode(data.code);
    const action=String(data.action??"state");
    await requireRoomMember(code,user);
    if(action==="state")return NextResponse.json({ok:true,participants:await participants(code)});
    if(action==="join"||action==="poll"){
      const muted=Boolean(data.muted);
      await db().query(`insert into retro_voice_participants (room_code,user_id,username,muted,last_seen) values ($1,$2,$3,$4,now()) on conflict (room_code,user_id) do update set username=excluded.username,muted=excluded.muted,last_seen=now()`,[code,user.id,user.username,muted]);
      const after=Math.max(0,Number(data.after??0)||0);
      const signals=await db().query<{id:string;sender_id:string;target_id:string;kind:string;payload:unknown}>(`select id::text,sender_id,target_id,kind,payload from retro_voice_signals where room_code=$1 and target_id=$2 and id>$3 order by id asc limit 100`,[code,user.id,after]);
      const cursor=signals.rows.length?Number(signals.rows[signals.rows.length-1].id):after;
      return NextResponse.json({ok:true,participants:await participants(code),signals:signals.rows.map(s=>({id:Number(s.id),senderId:s.sender_id,targetId:s.target_id,kind:s.kind,payload:s.payload})),cursor});
    }
    if(action==="signal"){
      const targetId=String(data.targetId??"");
      const kind=String(data.kind??"");
      if(!["offer","answer","ice"].includes(kind))throw new Error("Signal vocal invalide.");
      if(!(await db().query(`select 1 from retro_room_members where room_code=$1 and user_id=$2`,[code,targetId])).rowCount)throw new Error("Destinataire introuvable.");
      await db().query(`insert into retro_voice_signals (room_code,sender_id,target_id,kind,payload) values ($1,$2,$3,$4,$5::jsonb)`,[code,user.id,targetId,kind,JSON.stringify(data.payload??{})]);
      return NextResponse.json({ok:true});
    }
    if(action==="leave"){
      await db().query(`delete from retro_voice_participants where room_code=$1 and user_id=$2`,[code,user.id]);
      return NextResponse.json({ok:true});
    }
    throw new Error("Action inconnue.");
  }catch(error){
    const message=error instanceof Error?error.message:"Erreur inconnue.";
    return NextResponse.json({ok:false,error:message==="AUTH_REQUIRED"?"Connexion requise.":message},{status:message==="AUTH_REQUIRED"?401:400});
  }
}
