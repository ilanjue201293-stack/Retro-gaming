import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { cleanup, db, ensureSchema } from "@/lib/db";
import { cleanRoomCode, makeId, makeRoomCode } from "@/lib/utils";
import { requireRoomMember } from "@/lib/room";
import { hockeyConfigure, hockeyStart, hockeyState, hockeyStop, hockeySync, type HockeyMode } from "@/lib/hockey-room";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
async function payload(req: NextRequest) { try { return await req.json(); } catch { return {}; } }

async function roomState(code:string,userId:string) {
  const room = await db().query<{code:string;host_user_id:string}>(`select code,host_user_id from retro_rooms where code=$1 and expires_at>now() limit 1`, [code]);
  if (!room.rows[0]) throw new Error("Room introuvable ou expirée.");
  await db().query(`update retro_room_members set last_seen=now() where room_code=$1 and user_id=$2`, [code,userId]);
  await db().query(`update retro_rooms set updated_at=now(),expires_at=now()+interval '12 hours' where code=$1`, [code]);
  const members = await db().query<{id:string;username:string;online:boolean;joined_at:string}>(
    `select u.id,u.username,(m.last_seen>now()-interval '15 seconds') as online,m.joined_at::text
     from retro_room_members m join retro_users u on u.id=m.user_id
     where m.room_code=$1 order by m.joined_at`, [code]
  );
  return { code, hostId: room.rows[0].host_user_id, members: members.rows };
}
function pair(a:string,b:string):[string,string]{return a<b?[a,b]:[b,a]}

export async function POST(req:NextRequest){
  try{
    await ensureSchema();
    const data=await payload(req);
    const action=String(data.action??"state");
    const hockeyAction=action.startsWith("hockey");
    if(!hockeyAction) await cleanup();
    const user=await requireUser(req,!hockeyAction);

    if(action==="create"){
      let code="";
      for(let i=0;i<20;i++){
        const candidate=makeRoomCode();
        const r=await db().query(`insert into retro_rooms (code,host_user_id,expires_at) values ($1,$2,now()+interval '12 hours') on conflict do nothing`,[candidate,user.id]);
        if(r.rowCount){code=candidate;break}
      }
      if(!code)throw new Error("Impossible de créer une room.");
      await db().query(`insert into retro_room_members (room_code,user_id) values ($1,$2)`,[code,user.id]);
      return NextResponse.json({ok:true,room:await roomState(code,user.id)});
    }
    if(action==="join"){
      const code=cleanRoomCode(data.code);
      if(code.length!==5)throw new Error("Code invalide.");
      if(!(await db().query(`select 1 from retro_rooms where code=$1 and expires_at>now()`,[code])).rowCount)throw new Error("Room introuvable ou expirée.");
      await db().query(`insert into retro_room_members (room_code,user_id,joined_at,last_seen) values ($1,$2,now(),now()) on conflict (room_code,user_id) do update set last_seen=now()`,[code,user.id]);
      return NextResponse.json({ok:true,room:await roomState(code,user.id)});
    }
    if(action==="acceptInvite"){
      const inviteId=String(data.inviteId??"");
      const found=await db().query<{room_code:string}>(`select room_code from retro_room_invites where id=$1 and receiver_id=$2 and expires_at>now() limit 1`,[inviteId,user.id]);
      const row=found.rows[0];
      if(!row)throw new Error("Invitation expirée ou introuvable.");
      await db().query(`insert into retro_room_members (room_code,user_id) values ($1,$2) on conflict (room_code,user_id) do update set last_seen=now()`,[row.room_code,user.id]);
      await db().query(`delete from retro_room_invites where id=$1`,[inviteId]);
      return NextResponse.json({ok:true,room:await roomState(row.room_code,user.id)});
    }

    const code=cleanRoomCode(data.code);
    await requireRoomMember(code,user);

    if(action==="hockeyState") return NextResponse.json({ok:true,game:await hockeyState(code)});
    if(action==="hockeyConfigure") return NextResponse.json({ok:true,game:await hockeyConfigure(code,user.id,data.mode==="2v2"?"2v2":"1v1" as HockeyMode)});
    if(action==="hockeyStart") return NextResponse.json({ok:true,game:await hockeyStart(code,user.id)});
    if(action==="hockeyStop") return NextResponse.json({ok:true,game:await hockeyStop(code,user.id)});
    if(action==="hockeySync") return NextResponse.json({ok:true,game:await hockeySync(code,user.id,{x:data.x,y:data.y,vx:data.vx,vy:data.vy})});

    if(action==="state")return NextResponse.json({ok:true,room:await roomState(code,user.id)});
    if(action==="leave"){
      const current=await db().query<{host_user_id:string}>(`select host_user_id from retro_rooms where code=$1 limit 1`,[code]);
      await db().query(`delete from retro_room_members where room_code=$1 and user_id=$2`,[code,user.id]);
      await db().query(`delete from retro_voice_participants where room_code=$1 and user_id=$2`,[code,user.id]);
      if(current.rows[0]?.host_user_id===user.id){
        const next=await db().query<{user_id:string}>(`select user_id from retro_room_members where room_code=$1 order by joined_at limit 1`,[code]);
        if(next.rows[0])await db().query(`update retro_rooms set host_user_id=$1 where code=$2`,[next.rows[0].user_id,code]);
        else await db().query(`delete from retro_rooms where code=$1`,[code]);
      }
      return NextResponse.json({ok:true});
    }
    if(action==="invite"){
      const friendId=String(data.friendId??"");
      const [a,b]=pair(user.id,friendId);
      if(!(await db().query(`select 1 from retro_friends where user_a=$1 and user_b=$2`,[a,b])).rowCount)throw new Error("Cette personne n'est pas dans tes amis.");
      await db().query(`insert into retro_room_invites (id,room_code,sender_id,receiver_id,expires_at) values ($1,$2,$3,$4,now()+interval '2 hours') on conflict (room_code,receiver_id) do update set sender_id=excluded.sender_id,created_at=now(),expires_at=excluded.expires_at`,[makeId(),code,user.id,friendId]);
      return NextResponse.json({ok:true});
    }
    throw new Error("Action inconnue.");
  }catch(error){
    const message=error instanceof Error?error.message:"Erreur inconnue.";
    return NextResponse.json({ok:false,error:message==="AUTH_REQUIRED"?"Connexion requise.":message},{status:message==="AUTH_REQUIRED"?401:400});
  }
}
