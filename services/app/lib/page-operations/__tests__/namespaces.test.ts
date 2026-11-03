import {describe,it,expect} from 'vitest';
import {composePageSchema,executePageOperation,FieldFailed} from '../index';
import {DATASET_ROLES,type DatasetRole} from '@artifactbin/contracts';
import {resolverFieldRefusal} from '../namespaces';
const signal=new AbortController().signal;
const sources=[{name:'tasks',fileId:'backend1',version:'sha1',typeDefs:'type Query { value: Int } type Mutation { save(n:Int!):Int @auth(role:editor) }'}];
describe('page resolver isolation and authority',()=>{
 it('derives principal from caller and refuses viewer mutation before invoke',async()=>{
  const calls:unknown[]=[];const schema=composePageSchema(sources);
  const result=await executePageOperation({schema,request:{query:'mutation { tasks { save(n:2) } }'},caller:{pageId:'page1',subject:'user1',role:'viewer'},invoke:async c=>{calls.push(c);return 2;},signal});
  expect(calls).toEqual([]);expect(result.extensions?.outcomes).toEqual({'tasks.save':'rejected'});
 });
 it('does not replay an unknown mutation and still runs the next mutation serially',async()=>{
  const calls:string[]=[];const schema=composePageSchema(sources);
  // The principal carries the caller's page role (resolvers plan PR 5).
  const result=await executePageOperation({schema,request:{query:'mutation { tasks { first:save(n:1) second:save(n:2) } }'},caller:{pageId:'page1',subject:'user1',role:'editor'},invoke:async c=>{calls.push(c.field);expect(c.principal).toEqual({tenant:'page1',subject:'user1',role:'editor'});if(c.args.n===1)throw new FieldFailed('deadline');return 2;},signal});
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
 * THE ROLE TABLE: every page role (and none) against every @auth form. The Hasura role names mean
 * "at least"; any other name (an uppercase one included) is refused.
 */
describe('resolver @auth: page role x directive',()=>{
 const ok=null, NO='Not allowed', SIGN='Sign in required';
 type Cell=typeof ok|typeof NO|typeof SIGN;
 const rules:[string,{role?:string;signedIn?:boolean}|undefined][]=[
  ['no directive',undefined],['signedIn:true',{signedIn:true}],
  ['role:anonymous',{role:'anonymous'}],['role:signed_in',{role:'signed_in'}],['role:viewer',{role:'viewer'}],['role:editor',{role:'editor'}],['role:owner',{role:'owner'}],
  ['role:OWNER',{role:'OWNER'}],
  ['signedIn:true role:viewer',{signedIn:true,role:'viewer'}],['signedIn:true role:owner',{signedIn:true,role:'owner'}],
 ];
 // Columns follow `rules`; rows are the caller's page role.
 const table:Record<DatasetRole|'none',Cell[]>={
  none:      [NO,NO,  NO,NO,  NO,NO,NO, NO, NO,NO],
  anonymous: [ok,SIGN,ok,SIGN,NO,NO,NO, NO, SIGN,SIGN],
  signed_in: [ok,ok,  ok,ok,  NO,NO,NO, NO, NO,NO],
  viewer:    [ok,ok,  ok,ok,  ok,NO,NO, NO, ok,NO],
  editor:    [ok,ok,  ok,ok,  ok,ok,NO, NO, ok,NO],
  owner:     [ok,ok,  ok,ok,  ok,ok,ok, NO, ok,ok],
 };
 it('covers every role',()=>expect(Object.keys(table).filter(r=>r!=='none').sort()).toEqual([...DATASET_ROLES].sort()));
 for(const [role,cells] of Object.entries(table))
  it(`${role}`,()=>expect(rules.map(([,rule])=>resolverFieldRefusal(role==='none'?null:role as DatasetRole,rule))).toEqual(cells));
 it('refuses an unknown role name rather than treating it as open',()=>expect(resolverFieldRefusal('owner',{role:'admin'})).toBe(NO));
 it('applies the decision on the composed page before invoking',async()=>{
  const schema=composePageSchema([{name:'budget',fileId:'backend1',version:'v1',typeDefs:'type Query { n:Int } type Mutation { setTarget(n:Int!):Int @auth(role: signed_in) open(n:Int!):Int @auth(role: anonymous) }'}]);
  const run=(role:DatasetRole)=>{const calls:string[]=[];return executePageOperation({schema,request:{query:'mutation { budget { setTarget(n:1) open(n:1) } }'},caller:{pageId:'p',subject:null,role},signal,invoke:async c=>{calls.push(c.field);return 1;}}).then(r=>({r,calls}));};
  const guest=await run('anonymous');
  expect(guest.calls).toEqual(['open']);expect(guest.r.errors?.map(e=>e.message)).toEqual(['Sign in required']);
  expect((await run('signed_in')).calls).toEqual(['setTarget','open']);
 });
});

describe('generated dataset roots (dataset-hasura sources)', () => {
  const generated = (name: string, root = name) => ({
    name, fileId: `ds_${name}`, version: 'live', kind: 'dataset-hasura' as const,
    typeDefs: `enum order_by { asc desc }\ninput String_comparison_exp { _eq: String }\ntype ${root} { _id: ID! region: String }\ninput ${root}_bool_exp { region: String_comparison_exp }\ntype ${root}_mutation_response { affected_rows: Int! }\ntype Query {\n  ${root}(where: ${root}_bool_exp): [${root}!]!\n}\ntype Mutation {\n  delete_${root}(where: ${root}_bool_exp!): ${root}_mutation_response\n}\n`,
    roots: { [root]: { table: root, field: 'select' }, [`delete_${root}`]: { table: root, field: 'delete' } },
  });
  it('mounts roots flat with @dataset, nullable, and the shared prelude once', () => {
    const { sdl } = composePageSchema([...sources, generated('orders'), generated('notes')]);
    expect(sdl).toContain('orders(where: orders_bool_exp): [orders!] @dataset(link: "orders", file: "ds_orders", version: "live", table: "orders", field: "select")');
    expect(sdl).toContain('delete_notes(where: notes_bool_exp!): notes_mutation_response @dataset(link: "notes"');
    expect(sdl.match(/input String_comparison_exp/g)).toHaveLength(1);
    expect(sdl).toContain('tasks: tasks__Query!');
  });
  it('refuses a root equal to another link\'s name or root (graphql_root_collision)', () => {
    expect(() => composePageSchema([{ ...sources[0]!, name: 'orders_meta' }, generated('orders', 'orders_meta')])).toThrow(/graphql_root_collision: link orders generates orders_meta, which link orders_meta also names/);
    expect(() => composePageSchema([generated('a', 'orders'), generated('b', 'orders')])).toThrow(/graphql_root_collision/);
  });
  it('leaves a page with only resolver links byte-identical (no @dataset directive)', () => {
    const resolvers = [{ name: 'staff', fileId: 'rs1', version: 'v1', typeDefs: 'type Query { total: Int } type Mutation { setTotal: Int }' }];
    expect(composePageSchema(resolvers).sdl).not.toContain('@dataset');
    expect(composePageSchema(resolvers).sdl).toBe(composePageSchema(resolvers.map((s) => ({ ...s }))).sdl);
  });
  it('reads flat roots through the dataset port and sends a dataset mutation whole, keyed by root', async () => {
    const schema = composePageSchema([...sources, generated('orders')]);
    const calls: unknown[] = [];
    const datasets = {
      queryRoots: () => ({ orders: async (args: { where?: unknown }) => [{ _id: 'r1', region: JSON.stringify(args.where ?? null) }] }),
      mutate: async (request: unknown) => { calls.push(request); return { data: { gone: { affected_rows: 2 } } }; },
    };
    const caller = { pageId: 'page1', subject: 'u1', role: 'viewer' as const };
    const read = await executePageOperation({ schema, request: { query: '{ orders(where: {region: {_eq: "w"}}) { _id region } tasks { value } }' }, caller, signal, invoke: async () => 5, datasets });
    expect(read.data).toEqual({ orders: [{ _id: 'r1', region: '{"region":{"_eq":"w"}}' }], tasks: { value: 5 } });
    const write = await executePageOperation({ schema, request: { query: 'mutation { gone: delete_orders(where: {}) { affected_rows } }' }, caller, signal, invoke: async () => null, datasets });
    expect(write).toEqual({ data: { gone: { affected_rows: 2 } }, extensions: { outcomes: { gone: 'committed' } } });
    expect(calls).toEqual([{ query: 'mutation { gone: delete_orders(where: {}) { affected_rows } }' }]);
    const mixed = await executePageOperation({ schema, request: { query: 'mutation { delete_orders(where: {}) { affected_rows } tasks { save(n: 1) } }' }, caller: { ...caller, role: 'editor' }, signal, invoke: async () => 1, datasets });
    expect(mixed.errors?.[0]?.message).toMatch(/names only that dataset's fields/);
    const refused = await executePageOperation({ schema, request: { query: 'mutation { delete_orders(where: {}) { affected_rows } }' }, caller, signal, invoke: async () => null, datasets: { ...datasets, mutate: async () => ({ data: null, errors: [{ message: 'no', extensions: { code: 'permission_denied' } }] }) } });
    expect(refused).toEqual({ data: null, errors: [{ message: 'no', extensions: { code: 'permission_denied' } }], extensions: { outcomes: { delete_orders: 'rejected' } } });
  });
});

/**
 * THE BUILT-IN VIEWER: every composed page answers `{ viewer { signedIn id name } }` with no link. Signed in is the
 * `@auth(signedIn: true)` decision over the caller (and an account); the name comes from the lazy port only when
 * selected; nothing else about the reader is in the payload. Its root and type names are reserved.
 */
describe('built-in viewer query',()=>{
 const query='{ viewer { signedIn id name } }';
 const run=(caller:{subject:string|null;role:DatasetRole},viewerName?:(subject:string)=>Promise<string|null>,request=query)=>
  executePageOperation({schema:composePageSchema([]),request:{query:request},caller:{pageId:'page1',...caller},signal,invoke:async()=>{throw Error('no resolver runs');},...(viewerName?{viewerName}:{})});
 it('answers a page with no links: a signed-in caller reads its own subject and display name, never an email',async()=>{
  const asked:string[]=[];
  const result=await run({subject:'usr_1',role:'signed_in'},async subject=>{asked.push(subject);return 'Ada Lovelace';});
  expect(result).toEqual({data:{viewer:{signedIn:true,id:'usr_1',name:'Ada Lovelace'}}});
  expect(asked).toEqual(['usr_1']);
  expect(JSON.stringify(result)).not.toMatch(/@|email|token/i);
  for(const role of ['viewer','editor','owner'] as const)expect((await run({subject:'usr_1',role},async()=>'Ada')).data).toEqual({viewer:{signedIn:true,id:'usr_1',name:'Ada'}});
 });
 it('answers signed out with nulls and no error: no account, an anonymous role with a subject (a guest), or no subject at any role',async()=>{
  const name=async():Promise<string|null>=>{throw Error('a signed-out caller is never looked up');};
  for(const caller of [{subject:null,role:'anonymous'},{subject:'usr_guest',role:'anonymous'},{subject:null,role:'owner'}] as const)
   expect(await run(caller,name)).toEqual({data:{viewer:{signedIn:false,id:null,name:null}}});
 });
 it('reads the name only when the query selects it, and mounts beside linked namespaces',async()=>{
  let asked=0;
  const linked=[{name:'tasks',fileId:'backend1',version:'v1',typeDefs:'type Query { value: Int }'}];
  const result=await executePageOperation({schema:composePageSchema(linked),request:{query:'{ me: viewer { signedIn id } tasks { value } }'},caller:{pageId:'page1',subject:'usr_1',role:'viewer'},signal,invoke:async()=>7,viewerName:async()=>{asked++;return 'Ada';}});
  expect(result).toEqual({data:{me:{signedIn:true,id:'usr_1'},tasks:{value:7}}});
  expect(asked).toBe(0);
 });
 it('answers a signed-in name as null when no lookup is wired, and is not a mutation root',async()=>{
  expect((await run({subject:'usr_1',role:'signed_in'})).data).toEqual({viewer:{signedIn:true,id:'usr_1',name:null}});
  expect((await run({subject:'usr_1',role:'owner'},undefined,'mutation { viewer { signedIn } }')).errors?.length).toBe(1);
  expect(composePageSchema([]).sdl).toMatch(/type Viewer \{\s+signedIn: Boolean!\s+id: ID\s+name: String\s+\}/);
 });
 it('refuses a link named viewer or a dataset generating the viewer root or Viewer type, so nothing can shadow it',()=>{
  expect(()=>composePageSchema([{name:'viewer',fileId:'backend1',version:'v1',typeDefs:'type Query { signedIn: Boolean }'}])).toThrow(/viewer.*reserved/);
  const generated=(name:string)=>({name,fileId:`ds_${name}`,version:'live',kind:'dataset-hasura' as const,typeDefs:`type ${name} { _id: ID! }\ntype Query {\n  ${name}: [${name}!]!\n}\n`,roots:{[name]:{table:name,field:'select'}}});
  expect(()=>composePageSchema([generated('viewer')])).toThrow(/graphql_root_collision: link viewer generates viewer, the built-in viewer query/);
  expect(()=>composePageSchema([generated('Viewer')])).toThrow(/graphql_root_collision: link Viewer generates the type Viewer, the built-in viewer query/);
  // A resolver's own Viewer type stays private to its namespace.
  expect(composePageSchema([{name:'people',fileId:'backend1',version:'v1',typeDefs:'type Viewer { n: Int } type Query { me: Viewer }'}]).sdl).toContain('people__Viewer');
 });
});
