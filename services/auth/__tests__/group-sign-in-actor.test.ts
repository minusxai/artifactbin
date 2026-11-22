/**
 * AN AGENT SIGNED IN AS A GROUP, as an actor (contracts `GroupActor`): the bearer read's group record becomes an actor
 * carrying the group and its level and NO person; it crosses the network hop as exactly its own fields (a partial or
 * mixed claim is no one); the response revalidation compares the group and level too; and the type keeps it from ever
 * being read as a person's actor.
 */
import {expect,expectTypeOf,it} from 'vitest';
import {REVALIDATE_ACTOR_HEADER, isGroupActor, type Actor, type GroupActorRole, type HumanActor} from '@artifactbin/contracts/actor';
import type {TokenRecord} from '@artifactbin/contracts/identity';
import {signActor,verifyActor} from '@artifactbin/utils';
import {serviceAuthHost} from './helpers';

const SECRET='group-actor-hop-secret-000000000000000';
const ORIGIN='http://app.test';
const group={credential:'bearer',principal:'group',principalGroupId:'grp_team',principalGroupRole:'editor',tokenId:'tok_group',issuedBy:'usr_owner'} as const;
const sign=(claims:Record<string,unknown>)=>signActor(claims as unknown as Actor,SECRET);

it('is never a person: not assignable to a HumanActor, and narrowed by isGroupActor',()=>{
 expectTypeOf(group).not.toMatchTypeOf<HumanActor>();
 expectTypeOf<Extract<Actor,{principal:'group'}>['principalGroupRole']>().toEqualTypeOf<GroupActorRole>();
 expect(isGroupActor(group)).toBe(true);
 expect(isGroupActor({credential:'bearer',userId:'usr_owner',tokenId:'tok_x'})).toBe(false);
 expect(isGroupActor({credential:'none'})).toBe(false);
});

it('crosses the signed hop as exactly its own fields; partial, mixed or person-shaped claims are no one',()=>{
 expect(verifyActor(signActor(group,SECRET),SECRET)).toEqual(group);
 const interactive={...group,principalGroupRole:'admin'} as const;
 expect(verifyActor(signActor(interactive,SECRET),SECRET)).toEqual(interactive);
 for(const bad of [
  {...group,userId:'usr_owner'},{...group,email:'owner@example.test'},{...group,sessionId:'ses_1'},
  {...group,credential:'session'},{...group,principalGroupRole:'owner'},{...group,principalGroupId:''},
  {credential:'bearer',principal:'group',principalGroupId:'grp_team',principalGroupRole:'member',tokenId:'tok_group'},
  {credential:'bearer',tokenId:'tok_group',principalGroupId:'grp_team'},{credential:'bearer',tokenId:'tok_group',issuedBy:'usr_owner'},
 ])expect(verifyActor(sign(bad),SECRET),JSON.stringify(bad)).toBeNull();
 // A person's actor is unchanged by the new fields.
 expect(verifyActor(signActor({credential:'bearer',userId:'usr_owner',tokenId:'tok_x'},SECRET),SECRET)).toEqual({credential:'bearer',userId:'usr_owner',tokenId:'tok_x'});
});

it('a group record from the bearer read becomes the group actor, and a changed level at revalidation refuses the held rows',async()=>{
 let level:'member'|'editor'='editor';
 const record=():TokenRecord=>({id:'tok_group',userId:null,auditUserId:'usr_owner',groupId:'grp_team',groupRole:level,issuedBy:'usr_owner',audience:`${ORIGIN}/api`,scope:'artifacts'});
 const host=serviceAuthHost({env:{APP__PUBLIC_BASE_URL:ORIGIN},tokens:{byToken:async()=>record()},
  upstream:async(request,actor)=>{
   if(new URL(request.url).searchParams.has('revalidate'))level='member';
   return Response.json(actor,{headers:new URL(request.url).searchParams.has('revalidate')?{[REVALIDATE_ACTOR_HEADER]:'1'}:{}});
  }});
 const call=(path:string)=>host.fetch(new Request(ORIGIN+path,{headers:{authorization:`Bearer mx_${'g'.repeat(43)}`}}));
 const first=await call('/api/artifacts');
 expect(first.status).toBe(200);
 expect(await first.json()).toEqual({credential:'bearer',principal:'group',principalGroupId:'grp_team',principalGroupRole:'editor',tokenId:'tok_group',issuedBy:'usr_owner'});
 // The level moved while the request ran: the rows it held are not released.
 expect((await call('/api/artifacts?revalidate=1')).status).toBe(401);
 // A group token outside the API (the app's pages) is no one.
 level='editor';
 const page=await call('/a/abcdefgh');
 expect(await page.json().catch(()=>null)).not.toMatchObject({principal:'group'});
});
