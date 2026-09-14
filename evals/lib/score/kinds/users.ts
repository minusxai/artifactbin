/** One authored tracker, exercised as two real accounts. No feature syntax is supplied to the agent. */
import assert from 'node:assert/strict';
import type {DatasetColumn,Row} from '@artifactbin/contracts';
import type {Page} from 'playwright';
import type {Credential} from '../../credential';
import {DriverFailure,type TaskScorer,type CheckContext} from './contract';
import {datasetMutations,islandOf} from './tracker';

export const USER_CHECKS=['native_user_schema','user_picker_works','user_filter_works','user_completion_works','user_constraints_enforced','user_history_preserved'] as const;
export function nativeUserSchema(columns:DatasetColumn[],report:string):{assignee:string;completed:string}|null {
 const assignee=columns.find(c=>c.type==='user'&&c.constraints?.memberOf?.length===1&&c.constraints.memberOf[0]===`ref:${report}`&&!c.constraints.self);
 const completed=columns.find(c=>c.type==='user'&&c.constraints?.self===true);
 return assignee&&completed&&assignee.name!==completed.name?{assignee:assignee.name,completed:completed.name}:null;
}
interface Person extends Credential {id:string;label:string}
interface Fixture {owner:Person;member:Person;outsider:Person}
async function call(base:string,credential:Credential,path:string,body?:unknown,method=body===undefined?'GET':'PUT'):Promise<Response> {
 const response=await fetch(`${base}${path}`,{method,headers:{cookie:credential.cookie,'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
 if(response.status>=500)throw new DriverFailure('user flow HTTP',`${method} ${path}: ${response.status}`);
 return response;
}
async function person(base:string,credential:Credential):Promise<Person> {
 const session=await call(base,credential,'/api/auth/get-session');
 const identity=await session.json() as {user?:{id:string}};
 assert.ok(identity.user?.id,'real logged-in account');
 const profile=await (await call(base,credential,'/api/my/profile')).json() as {name?:string;username:string};
 return {...credential,id:identity.user.id,label:profile.name||profile.username};
}
async function verify(ctx:CheckContext,checks:Record<string,boolean>) {
 const driver=ctx.driver,fixture=ctx.fixture?.state as Fixture|undefined;
 if(!driver||!fixture)throw new DriverFailure('user fixture','Missing multi-account fixture');
 const id=ctx.scoredId??ctx.startId;
 assert.equal(id,ctx.startId,'use the report whose membership was seeded');
 const island=islandOf(ctx.served.html);
 assert.ok(island,'published dataflow');
 const targets=[...new Set(datasetMutations(island).map(m=>m.target))];
 assert.equal(targets.length,1,'one persistent task dataset');
 const datasetId=targets[0]!;
 const api=(who:Credential,path:string,body?:unknown,method?:string)=>call(ctx.productUrl,who,path,body,method);
 const read=async()=>{
  const res=await fetch(`${ctx.productUrl}/api/artifacts/${datasetId}`,{headers:{authorization:`Bearer ${ctx.token}`}});
  if(!res.ok)throw new DriverFailure('read user dataset',String(res.status));
  return res.json() as Promise<{columns:DatasetColumn[];rows:Row[]}>;
 };
 const before=await read();
 const schema=nativeUserSchema(before.columns,id);
 assert.ok(schema,'native user membership and self constraints');
 assert.equal(before.rows.length,2,'two seeded tasks');
 assert.ok(before.rows.every(r=>r[schema.assignee]==null&&r[schema.completed]==null),'unassigned and incomplete initial rows');
 checks.native_user_schema=true;
 ctx.checkpoint?.('native_user_schema');
 // Sharing is a human action. The fixture grants dataset access; the agent must author the field constraints.
 const share=await api(fixture.owner,`/api/my/artifacts/${datasetId}/sharing`,{shares:[{email:fixture.member.email,role:'editor'}]});
 assert.equal(share.status,200,'member dataset edit access');
 const contexts=await Promise.all([fixture.owner,fixture.member].map(who=>driver.browser.newContext({extraHTTPHeaders:{cookie:who.cookie},viewport:{width:1200,height:900}})));
 try {
  const pages=await Promise.all(contexts.map(c=>c.newPage()));
  const owner=pages[0]!,member=pages[1]!;
  for(const page of pages)page.setDefaultTimeout(4000);
  const open=async(page:Page)=>{
   await page.goto(`${ctx.productUrl}/a/${id}`,{waitUntil:'domcontentloaded'});
   await page.locator('body > #root [data-mx-inline-story]').waitFor();
  };
  const write=async(page:Page,action:()=>Promise<unknown>)=>{
   const response=page.waitForResponse(r=>r.url().endsWith(`/a/${id}/mutate`)&&r.request().method()==='POST');
   const [result]=await Promise.all([response,action()]);
   assert.equal(result.status(),200,await result.text());
   return result.request().postDataJSON() as {mutation:string;values:Record<string,unknown>;row:Row};
  };
  await open(owner);
  await owner.getByRole('button',{name:'Assign task',exact:true}).first().click();
  const names=await owner.getByRole('option').allTextContents();
  assert.ok(names.includes(fixture.owner.label)&&names.includes(fixture.member.label),'both report members offered');
  assert.ok(!names.includes(fixture.outsider.label),'outsider absent');
  await owner.getByRole('searchbox',{name:'Search Assign task',exact:true}).fill(fixture.member.label);
  await owner.getByRole('option',{name:fixture.member.label,exact:true}).waitFor();
  assert.equal(await owner.getByRole('option').count(),1,'search narrows member choices');
  const assignment=await write(owner,()=>owner.getByRole('option',{name:fixture.member.label,exact:true}).click());
  assert.equal((await read()).rows.filter(r=>r[schema.assignee]===fixture.member.id).length,1,'assignment persists as ID');
  checks.user_picker_works=true;
 ctx.checkpoint?.('user_picker_works');
  await owner.getByRole('button',{name:'Assignee filter',exact:true}).click();
  await owner.getByRole('option',{name:fixture.member.label,exact:true}).click();
  await owner.waitForFunction(()=>document.querySelectorAll('button[aria-label="Assign task"]').length===1);
  checks.user_filter_works=true;
 ctx.checkpoint?.('user_filter_works');
  await open(member);
  await member.route(`**/a/${id}/mutate`,route=>{
   const body=route.request().postDataJSON();
   return route.continue({postData:JSON.stringify({...body,values:{...body.values,_me:fixture.owner.id}})});
  });
  await write(member,()=>member.getByRole('button',{name:'Complete task',exact:true}).first().click());
  let completed=(await read()).rows;
  assert.equal(completed.filter(r=>r[schema.completed]===fixture.member.id).length,1,'actual clicking account persisted');
  await member.getByRole('cell',{name:fixture.member.label,exact:true}).last().waitFor();
  // Reload verifies names come from persistent identity data, not a transient optimistic label.
  await open(member);
  await member.getByRole('cell',{name:fixture.member.label,exact:true}).last().waitFor();
  checks.user_completion_works=true;
 ctx.checkpoint?.('user_completion_works');
  const snapshot=JSON.stringify((await read()).rows);
  const sql=async(who:Credential,statement:string)=>{
   const res=await fetch(`${ctx.productUrl}/api/artifacts/${datasetId}/mutate`,{method:'POST',headers:{authorization:`Bearer ${who.token}`,'content-type':'application/json'},body:JSON.stringify({sql:statement})});
   return res.status;
  };
  const quote=(name:string)=>`"${name.replaceAll('"','""')}"`;
  assert.equal(await sql(fixture.owner,`update public.rows set ${quote(schema.assignee)}='${fixture.outsider.id}'`),403,'outsider mutation refused');
  assert.equal(await sql(fixture.owner,`update public.rows set ${quote(schema.completed)}='${fixture.member.id}'`),403,'forged identity refused');
  assert.equal(JSON.stringify((await read()).rows),snapshot,'rejected writes are atomic');
  assert.ok((await read()).rows.every(r=>r[schema.completed]!==fixture.owner.id),'forged client actor never stored');
  checks.user_constraints_enforced=true;
 ctx.checkpoint?.('user_constraints_enforced');
  await open(owner);
  await write(owner,()=>owner.getByRole('button',{name:'Complete task',exact:true}).last().click());
  completed=(await read()).rows;
  assert.equal(completed.filter(r=>r[schema.completed]===fixture.owner.id).length,1,'owner click records owner, not a hardcoded teammate');
  assert.equal(completed.filter(r=>r[schema.completed]===fixture.member.id).length,1,'teammate completion persists');
  const title=owner.getByRole('textbox',{name:'Task title',exact:true}).first();
  await title.fill('Launch docs updated');
  await write(owner,()=>title.press('Enter'));
  const after=(await read()).rows;
  assert.ok(after.some(r=>Object.values(r).includes('Launch docs updated')),'unrelated edit persisted');
  assert.deepEqual(after.map(r=>r[schema.completed]),completed.map(r=>r[schema.completed]),'historical completing identity unchanged');
  checks.user_history_preserved=true;
 ctx.checkpoint?.('user_history_preserved');
  ctx.record('user_flow_probe',`Two-account assignment, search, filter, completion, forged writes and historical identity verified; assignment mutation ${assignment.mutation}.`,'text');
 } finally {await Promise.all(contexts.map(c=>c.close()));}
}
export const userScorer={
 kind:'users',checkNames:USER_CHECKS,
 async setup(ctx){
  const driver=ctx.driver;
  if(!driver)throw new DriverFailure('user fixture','Multi-account driver unavailable');
  const [member,outsider]=await Promise.all(['member','outsider'].map(name=>driver.createAccount(`mxmx_test_users_${ctx.id}_${name}@example.com`)));
  const [ownerPerson,memberPerson,outsiderPerson]=await Promise.all([driver.credential,member,outsider].map(c=>person(driver.productUrl,c)));
  const response=await call(driver.productUrl,driver.credential,`/api/my/artifacts/${ctx.id}/sharing`,{shares:[{email:member.email,role:'editor'}]});
  assert.equal(response.status,200,`seed shared report: ${response.status} ${await response.text()}`);
  return {state:{owner:ownerPerson,member:memberPerson,outsider:outsiderPerson} satisfies Fixture,brief:`This report's second editor is ${memberPerson.label} (${member.email}).`};
 },
 async checks(ctx){
  const checks:Record<string,boolean>=Object.fromEntries(USER_CHECKS.map(name=>[name,false]));
  try {await verify(ctx,checks);} catch(error){
   if(error instanceof DriverFailure)throw error;
   ctx.record('user_flow_probe',error instanceof Error?error.message:String(error),'text');
  }
  return checks;
 },
} as const satisfies TaskScorer;
