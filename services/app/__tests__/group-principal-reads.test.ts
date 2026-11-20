/**
 * WHAT AN AGENT SIGNED IN AS A GROUP READS, and where it may go at all (lib/artifact-access, server/group-admission): on
 * Root > Team > Squad, a Team sign-in reads exactly what a direct member of Team reads, at either level; every API route
 * the admission list does not name refuses it with the one code.
 */
import {GROUP_PRINCIPAL_REFUSED} from '@artifactbin/contracts/actor';
import {ROUTES} from '@/server/routes.generated';
import {GROUP_ADMITTED_ROUTES,groupAdmitted} from '@/server/group-admission';
import {expect,it} from 'vitest';
import {useAppHarness} from './harness';
import {composed,useGroupPrincipalHost,world} from './group-principal-fixture';
useAppHarness();
useGroupPrincipalHost();

it('reads exactly what a direct member of the group reads, at either level',async()=>{
 const host=await composed(),{eve,team,pages}=await world(host);
 for(const role of ['member','editor'] as const){
  const agent=await eve.asGroup(team.id,role);
  const status=async(id:string)=>(await host.call('GET',`/api/artifacts/${id}`,agent.token)).status;
  // Team's own, its ancestor's, shares to Team or Root, and the link: readable.
  for(const id of [pages.team,pages.root,pages.sharedTeam,pages.sharedRoot,pages.linkCommenter])expect(await status(id),`${role} ${id}`).toBe(200);
  // A subgroup's page and a share to it, a person's page, a share by email to the person who signed it in: never.
  for(const id of [pages.squad,pages.sharedSquad,pages.personal,pages.emailed])expect(await status(id),`${role} ${id}`).toBe(404);
 }
});

it('default deny: every route a bearer reaches that the admission list does not name refuses a group agent with the one code, and every named one admits it',async()=>{
 const host=await composed(),{eve,team}=await world(host);
 const agent=await eve.asGroup(team.id,'editor');
 const checked:string[]=[];
 for(const route of ROUTES){
  // The API, and the reader's read adapters the identity host admits a bearer to (auth parts `tokenFitsRequest`).
  const adapter=/^\/a\/:id\/(?:download|export)$/.test(route.path);
  if(!adapter&&(!route.path.startsWith('/api/')||route.path.startsWith('/api/internal/')||route.path.startsWith('/api/auth')))continue;
  for(const method of route.methods){
   if(method==='HEAD'||method==='OPTIONS')continue;
   const path=route.path.replace(/:[A-Za-z]+/g,'x0x0x0');
   const answer=await host.call(method,path,agent.token,method==='GET'||method==='DELETE'?undefined:{});
   const refused=answer.status===403&&answer.body?.error===GROUP_PRINCIPAL_REFUSED;
   // The oracle is the list itself, by the generated route pattern: a route added under an admitted pattern still refuses.
   const listed=GROUP_ADMITTED_ROUTES.some(([m,p])=>m===method&&p===route.path);
   expect(groupAdmitted(method,path),`${method} ${route.path} matched by the edge`).toBe(listed);
   expect(refused,`${method} ${route.path} ${answer.status} ${JSON.stringify(answer.body)?.slice(0,120)}`).toBe(!listed);
   checked.push(`${method} ${route.path}`);
  }
 }
 // The list names only routes that exist, and the walk saw each of them.
 for(const [method,path] of GROUP_ADMITTED_ROUTES)expect(checked,`${method} ${path}`).toContain(`${method} ${path}`);
});
