import {describe,it,expect} from 'vitest';
import {composePageSchema,executePageOperation,FieldFailed} from '../index';
import {DATASET_ROLES,type DatasetRole} from '@artifactbin/contracts';
import {resolverFieldRefusal} from '../namespaces';
const signal=new AbortController().signal;
const sources=[{name:'tasks',fileId:'backend1',version:'sha1',typeDefs:'type Query { value: Int } type Mutation { save(n:Int!):Int @auth(role:EDITOR) }'}];
describe('page resolver isolation and authority',()=>{
 it('derives principal from caller and refuses viewer mutation before invoke',async()=>{
  const calls:unknown[]=[];const schema=composePageSchema(sources);
  const result=await executePageOperation({schema,request:{query:'mutation { tasks { save(n:2) } }'},caller:{pageId:'page1',subject:'user1',role:'viewer'},invoke:async c=>{calls.push(c);return 2;},signal});
  expect(calls).toEqual([]);expect(result.extensions?.outcomes).toEqual({'tasks.save':'rejected'});
 });
 it('does not replay an unknown mutation and still runs the next mutation serially',async()=>{
  const calls:string[]=[];const schema=composePageSchema(sources);
  const result=await executePageOperation({schema,request:{query:'mutation { tasks { first:save(n:1) second:save(n:2) } }'},caller:{pageId:'page1',subject:'user1',role:'editor'},invoke:async c=>{calls.push(c.field);expect(c.principal).toEqual({tenant:'page1',subject:'user1'});if(c.args.n===1)throw new FieldFailed('deadline');return 2;},signal});
  expect(calls).toEqual(['save','save']);expect(result.extensions?.outcomes).toEqual({'tasks.first':'unknown','tasks.second':'committed'});
 });
 it('keeps duplicate file type names in private namespaces',()=>{
  const schema=composePageSchema([{...sources[0]!,typeDefs:'type Query { value: Thing } type Thing { n:Int }'},{name:'other',fileId:'backend2',version:'sha2',typeDefs:'type Query { value: Thing } type Thing { s:String }'}]);
  expect(schema.sdl).toContain('tasks__Thing');expect(schema.sdl).toContain('other__Thing');
 });
});
it('preflights the actual bounded operation rather than trusting a page label',async()=>{
 const {pageOperationKind}=await import('../index');
 expect(pageOperationKind('mutation { tasks { save(n:2) } }')).toBe('mutation');
 expect(pageOperationKind('query A { tasks { value } } mutation B { tasks { save(n:2) } }','B')).toBe('mutation');
 expect(pageOperationKind('query A { tasks { value } } mutation B { tasks { save(n:2) } }')).toBeNull();
});

it('preserves authoritative adapter receipt outcomes without interpreting arbitrary backend JSON',async()=>{
 let calls=0;
 const schema=composePageSchema([{name:'data',fileId:'dataset1',version:'live',typeDefs:'type Receipt { outcome:String! } type Query { x:Int } type Mutation { write:Receipt! }'}]);
 const result=await executePageOperation({schema,request:{query:'mutation { data { rejected:write {outcome} unknown:write {outcome} author:write {outcome} } }'},caller:{pageId:'page1',subject:'u1',role:'owner'},signal,invoke:async call=>{
  if(call.field!=='write')return null;
  calls++;
  if(calls===1)call.reportOutcome?.('rejected');
  if(calls===2)call.reportOutcome?.('unknown');
  return {outcome:calls===2?'unknown':'rejected'};
 }});
 expect(result.extensions?.outcomes).toEqual({'data.rejected':'rejected','data.unknown':'unknown','data.author':'committed'});
 expect(result.data).toEqual({data:{rejected:{outcome:'rejected'},unknown:{outcome:'unknown'},author:{outcome:'rejected'}}});
});


it('returns multi-megabyte selected data through the normal composed operation', async () => {
  const schema = composePageSchema([{
    name: 'records', fileId: 'backend', version: 'one', typeDefs: 'type Query { payload: String! }',
  }]);
  const payload = 'x'.repeat(2_400_000);
  const response = await executePageOperation({
    schema, request: { query: '{ records { payload } }' },
    caller: { pageId: 'page', subject: null, role: 'anonymous' },
    signal, invoke: async () => payload,
  });
  expect(response.errors).toBeUndefined();
  expect(response.data).toEqual({ records: { payload } });
});

it('bounds the exact serialized selected data without charging schema or response wrappers', async () => {
  const { PAGE_OPERATION_RESULT_BYTES } = await import('../contracts');
  const schema = composePageSchema([{
    name: 'records', fileId: 'backend', version: 'one', typeDefs: 'type Query { payload: String! }',
  }]);
  const overhead = Buffer.byteLength(JSON.stringify({ records: { payload: '' } }));
  let length = PAGE_OPERATION_RESULT_BYTES - overhead;
  const run = () => executePageOperation({
    schema, request: { query: '{ records { payload } }' },
    caller: { pageId: 'page', subject: null, role: 'anonymous' },
    signal, invoke: async () => 'x'.repeat(length),
  });
  const exact = await run();
  expect(exact.errors).toBeUndefined();
  expect(Buffer.byteLength(JSON.stringify(exact.data))).toBe(PAGE_OPERATION_RESULT_BYTES);
  length++;
  expect(await run()).toEqual({
    data: null, errors: [{ message: 'The selected result is larger than 4 MiB' }],
  });
});

/**
 * THE ROLE TABLE: every page role (and none) against every @auth form. Lowercase Hasura names mean
 * "at least"; legacy uppercase keep their original meaning (VIEWER = any reader, so anonymous).
 */
describe('resolver @auth: page role x directive',()=>{
 const ok=null, NO='Not allowed', SIGN='Sign in required';
 type Cell=typeof ok|typeof NO|typeof SIGN;
 const rules:[string,{role?:string;signedIn?:boolean}|undefined][]=[
  ['no directive',undefined],['signedIn:true',{signedIn:true}],
  ['role:anonymous',{role:'anonymous'}],['role:signed_in',{role:'signed_in'}],['role:viewer',{role:'viewer'}],['role:editor',{role:'editor'}],['role:owner',{role:'owner'}],
  ['role:VIEWER',{role:'VIEWER'}],['role:EDITOR',{role:'EDITOR'}],['role:OWNER',{role:'OWNER'}],
  ['signedIn:true role:VIEWER',{signedIn:true,role:'VIEWER'}],['signedIn:true role:OWNER',{signedIn:true,role:'OWNER'}],
 ];
 // Columns follow `rules`; rows are the caller's page role.
 const table:Record<DatasetRole|'none',Cell[]>={
  none:      [NO,NO,  NO,NO,  NO,NO,NO, NO,NO,NO, NO,NO],
  anonymous: [ok,SIGN,ok,SIGN,NO,NO,NO, ok,NO,NO, SIGN,SIGN],
  signed_in: [ok,ok,  ok,ok,  NO,NO,NO, ok,NO,NO, ok,NO],
  viewer:    [ok,ok,  ok,ok,  ok,NO,NO, ok,NO,NO, ok,NO],
  editor:    [ok,ok,  ok,ok,  ok,ok,NO, ok,ok,NO, ok,NO],
  owner:     [ok,ok,  ok,ok,  ok,ok,ok, ok,ok,ok, ok,ok],
 };
 it('covers every role',()=>expect(Object.keys(table).filter(r=>r!=='none').sort()).toEqual([...DATASET_ROLES].sort()));
 for(const [role,cells] of Object.entries(table))
  it(`${role}`,()=>expect(rules.map(([,rule])=>resolverFieldRefusal(role==='none'?null:role as DatasetRole,rule))).toEqual(cells));
 it('refuses an unknown role name rather than treating it as open',()=>expect(resolverFieldRefusal('owner',{role:'admin'})).toBe(NO));
 it('applies the decision on the composed page before invoking',async()=>{
  const schema=composePageSchema([{name:'budget',fileId:'backend1',version:'v1',typeDefs:'type Query { n:Int } type Mutation { setTarget(n:Int!):Int @auth(role: signed_in) legacy(n:Int!):Int @auth(role: VIEWER) }'}]);
  const run=(role:DatasetRole)=>{const calls:string[]=[];return executePageOperation({schema,request:{query:'mutation { budget { setTarget(n:1) legacy(n:1) } }'},caller:{pageId:'p',subject:null,role},signal,invoke:async c=>{calls.push(c.field);return 1;}}).then(r=>({r,calls}));};
  const guest=await run('anonymous');
  expect(guest.calls).toEqual(['legacy']);expect(guest.r.errors?.map(e=>e.message)).toEqual(['Sign in required']);
  expect((await run('signed_in')).calls).toEqual(['setTarget','legacy']);
 });
});
