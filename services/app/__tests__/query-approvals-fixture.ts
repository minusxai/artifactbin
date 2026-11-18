/**
 * THE FIXTURE for the approved-query tests (query-approvals*.test.ts): the composed host of the group-principal tests,
 * and a real Postgres engine on a loopback socket (test-support pglite-wire) as the install's default connection, whose
 * guarded view refuses (42501) any reader whose groups are not allowed and shows the reader values it was sent. Root >
 * Team > Squad: Ada created all three (Admin), Rob is Team's Admin, Eve its Editor, Mia its Member; Olga is outside it.
 */
import {afterAll,beforeAll,beforeEach,expect} from 'vitest';
import {startPgliteWire,type PgliteWire} from '@artifactbin/test-support/pglite-wire';
import {closeDefaultConnection} from '@/lib/connections';
import {overrideConfig} from '@/lib/platform/config';
import {useAppHarness,admitGroupMember} from './harness';
import {SECRET,composed,origin,useGroupPrincipalHost,world} from './group-principal-fixture';

let wire:PgliteWire;
/** The harness, the composed host's settings and the default connection, for one test file. */
export function useApprovalsHost():void{
 useAppHarness();
 useGroupPrincipalHost();
 beforeAll(async()=>{wire=await startPgliteWire(`
  create schema sales; create table sales.orders(region text, amount int, secret text);
  insert into sales.orders values ('EU',10,'eu-margin'),('EU',5,'eu-margin-2'),('US',7,'us-margin');
  create table public.allowed_groups(id text primary key);
  create function sales.guarded() returns setof sales.orders language plpgsql stable as $$
  begin
    if not exists (select 1 from public.allowed_groups a where current_setting('app.viewer_groups', true) like '%"' || a.id || '"%') then
      raise exception 'sales are not shared with this reader' using errcode = 'insufficient_privilege';
    end if;
    return query select * from sales.orders;
  end $$;
  create view sales.visible as select * from sales.guarded();`);});
 afterAll(async()=>{await closeDefaultConnection();await wire?.close();});
 beforeEach(()=>{overrideConfig({internalServiceSecret:SECRET,publicBaseUrl:origin},{DATASETS__DEFAULT_CONNECTION:JSON.stringify({connector:'postgres',host:'127.0.0.1',port:wire.port,database:'postgres',user:'postgres',password:'x',tls:'disable'}),DATASETS__ALLOW_PRIVATE_NETWORK:'1'});});
}

/** What the database saw of the reader, beside the numbers: the session's values and the bound ones. */
const SEEN=`current_setting('app.viewer_id', true) as seen_id, current_setting('app.viewer_email', true) as seen_email, current_setting('app.viewer_groups', true) as seen_groups,
 current_setting('app.viewer_group_role', true) as seen_level, :viewer_id as bound_id, :viewer_email as bound_email, :viewer_groups as bound_groups, :viewer_group_role as bound_level`;
export const TOTALS=`select region, sum(amount)::int as total, ${SEEN} from wh.sales.visible where region = :region group by region`;
export const SENSITIVE=`select region, secret, ${SEEN} from wh.sales.visible where region = :region`;
const PARAMS='{"region":["EU","US"]}';
export const html=(query=TOTALS,{params=PARAMS,href='default:',name='wh'}:{params?:string;href?:string;name?:string}={})=>`<!doctype html><html><head><link rel="af-dataset" data-af-name="${name}" href="${href}">
<script type="application/sql" data-af-query="totals" data-af-dataset="${name}" data-af-params='${params}'>${query}</script></head><body><h1>Sales</h1></body></html>`;

export type Host=Awaited<ReturnType<typeof composed>>;
export async function setting(host:Host){
 const {ada,eve,root,team,squad}=await world(host,false);
 const rob=await host.signIn('mxmx_test_qa_rob@example.test'),mia=await host.signIn('mxmx_test_qa_mia@example.test'),olga=await host.signIn('mxmx_test_qa_olga@example.test');
 await admitGroupMember(ada.userId,team.id,rob.userId,'admin');
 await admitGroupMember(ada.userId,team.id,mia.userId,'member');
 // The data is the team's: its members read it themselves; Olga has no access of her own.
 await wire.db.query('delete from public.allowed_groups');
 await wire.db.query('insert into public.allowed_groups values ($1)',[team.id]);
 const made=await host.call('POST','/api/artifacts',ada.token,{title:'Sales',html:html(),destination:{type:'group',id:team.id},visibility:'private',shares:[{email:'mxmx_test_qa_olga@example.test',role:'viewer'}]});
 expect(made.status,JSON.stringify(made.body)).toBe(201);
 const page=String(made.body!.id);
 /** A reader runs the declared query `totals` (of `revision`, default the head), as the page's chart would. */
 const read=async(who:{token:string},params:Record<string,unknown>={region:'EU'},extra:Record<string,unknown>={})=>{
  const revision=extra.revision??String((await host.call('GET',`/api/artifacts/${page}`,ada.token)).body!.version);
  return host.call('POST',`/api/artifacts/${page}/sql`,who.token,{query:'totals',params,...extra,revision});
 };
 const approvals=(who:{token:string})=>host.call('GET',`/api/artifacts/${page}/query-approvals`,who.token);
 const approve=async(who:{token:string},hash?:string)=>host.call('POST',`/api/artifacts/${page}/query-approvals`,who.token,{query:'totals',hash:hash??((await approvals(ada)).body!.queries as Array<{hash:string}>)[0]!.hash});
 const edit=async(who:{token:string},next:string)=>{
  const current=await host.call('GET',`/api/artifacts/${page}`,who.token);
  const saved=await host.call('PUT',`/api/artifacts/${page}`,who.token,{html:next,expectedVersion:current.body?.version,expectedState:current.body?.state});
  expect(saved.status,JSON.stringify(saved.body)).toBe(200);
 };
 return {ada,eve,rob,mia,olga,root,team,squad,page,read,approvals,approve,edit};
}
const NOTICE="You don't have access to this data. Ask Team, who owns this page, for access.";
/** The same refusal without a name: what a reader who is not a signed-in account gets (contracts sql-failures). */
export const NAMELESS="You don't have access to this data. Ask the page's owner for access.";
export const refusedNamingOwner=(reply:{status:number;body:Record<string,unknown>|null})=>expect([reply.status,reply.body?.error,reply.body?.notice],JSON.stringify(reply.body)).toEqual([403,'permission_denied',NOTICE]);
export const rows=(reply:{status:number;body:Record<string,unknown>|null})=>{expect(reply.status,JSON.stringify(reply.body)).toBe(200);return reply.body!.rows as Array<Record<string,unknown>>;};
export const asGroup=(team:string)=>({seen_id:'',seen_email:'',seen_groups:JSON.stringify([team]),seen_level:'member',bound_id:null,bound_email:null,bound_groups:JSON.stringify([team]),bound_level:'member'});
