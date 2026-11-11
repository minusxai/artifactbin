import {describe,it,expect} from 'vitest';
import {composePageSchema,executePageOperation} from '../index';
import {type DatasetRole,type HtmlJsonObject} from '@artifactbin/contracts';
const signal=new AbortController().signal;
it('preflights the actual bounded operation rather than trusting a page label',async()=>{
 const {pageOperationKind}=await import('../index');
 expect(pageOperationKind('mutation { delete_tasks(where: {}) { affected_rows } }')).toBe('mutation');
 expect(pageOperationKind('query A { tasks { _id } } mutation B { delete_tasks(where: {}) { affected_rows } }','B')).toBe('mutation');
 expect(pageOperationKind('query A { tasks { _id } } mutation B { delete_tasks(where: {}) { affected_rows } }')).toBeNull();
});
it('composes dataset links only: any other source refuses the page',()=>{
 expect(()=>composePageSchema([{name:'tasks',fileId:'backend1',version:'v1',typeDefs:'type Query { value: Int }'} as never])).toThrow(/dataset links only/);
});

describe('the selected data bound', () => {
  const records = { name: 'records', fileId: 'ds_records', version: 'live', kind: 'dataset-hasura' as const,
    typeDefs: 'type records { payload: String! }\ntype Query {\n  records: records\n}\n', roots: { records: { table: 'records', field: 'select' } } };
  const run = (payload: string) => executePageOperation({
    schema: composePageSchema([records]), request: { query: '{ records { payload } }' },
    caller: { pageId: 'page', subject: null, role: 'anonymous' }, signal,
    datasets: { queryRoots: () => ({ records: async () => ({ payload }) }), mutate: async () => ({ data: null }), sql: async () => ({ columns: [], rows: [] }) },
  });
  it('returns multi-megabyte selected data through the normal composed operation', async () => {
    const payload = 'x'.repeat(2_400_000);
    const response = await run(payload);
    expect(response.errors).toBeUndefined();
    expect(response.data).toEqual({ records: { payload } });
  });
  it('bounds the exact serialized selected data without charging schema or response wrappers', async () => {
    const { PAGE_OPERATION_RESULT_BYTES } = await import('../contracts');
    const overhead = Buffer.byteLength(JSON.stringify({ records: { payload: '' } }));
    const exact = await run('x'.repeat(PAGE_OPERATION_RESULT_BYTES - overhead));
    expect(exact.errors).toBeUndefined();
    expect(Buffer.byteLength(JSON.stringify(exact.data))).toBe(PAGE_OPERATION_RESULT_BYTES);
    expect(await run('x'.repeat(PAGE_OPERATION_RESULT_BYTES - overhead + 1))).toEqual({
      data: null, errors: [{ message: 'The selected result is larger than 4 MiB' }],
    });
  });
});

describe('generated dataset roots (dataset-hasura sources)', () => {
  const generated = (name: string, root = name) => ({
    name, fileId: `ds_${name}`, version: 'live', kind: 'dataset-hasura' as const,
    typeDefs: `enum order_by { asc desc }\ninput String_comparison_exp { _eq: String }\ntype ${root} { _id: ID! region: String }\ninput ${root}_bool_exp { region: String_comparison_exp }\ntype ${root}_mutation_response { affected_rows: Int! }\ntype Query {\n  ${root}(where: ${root}_bool_exp): [${root}!]!\n}\ntype Mutation {\n  delete_${root}(where: ${root}_bool_exp!): ${root}_mutation_response\n}\n`,
    roots: { [root]: { table: root, field: 'select' }, [`delete_${root}`]: { table: root, field: 'delete' } },
  });
  it('mounts roots flat with @dataset, nullable, and the shared prelude once', () => {
    const { sdl } = composePageSchema([generated('orders'), generated('notes')]);
    expect(sdl).toContain('orders(where: orders_bool_exp): [orders!] @dataset(link: "orders", file: "ds_orders", version: "live", table: "orders", field: "select")');
    expect(sdl).toContain('delete_notes(where: notes_bool_exp!): notes_mutation_response @dataset(link: "notes"');
    expect(sdl.match(/input String_comparison_exp/g)).toHaveLength(1);
  });
  it('refuses a root another link also generates (graphql_root_collision)', () => {
    expect(() => composePageSchema([generated('a', 'orders'), generated('b', 'orders')])).toThrow(/graphql_root_collision/);
  });
  it('reserves _sql and its types: no link root or generated type may take them', () => {
    expect(() => composePageSchema([generated('_sql')])).toThrow(/graphql_root_collision: link _sql generates _sql, the built-in read-only SQL query/);
    expect(() => composePageSchema([generated('orders', 'SqlResult')])).toThrow(/graphql_root_collision/);
    expect(() => composePageSchema([generated('JSON')])).toThrow(/graphql_root_collision/);
  });
  it('mounts _sql only on a page that links a dataset, and runs it through the port with checked arguments', async () => {
    expect(composePageSchema([]).sdl).not.toContain('_sql');
    const schema = composePageSchema([generated('orders')]);
    expect(schema.sdl).toMatch(/_sql\(sql: String!, params: JSON\): SqlResult\n/);
    const asked: unknown[] = [];
    const datasets = {
      queryRoots: () => ({}), mutate: async () => ({ data: null }),
      sql: async (call: { sql: string; params: Readonly<Record<string, unknown>> }) => { asked.push(call); return { columns: [{ name: 'n', type: 'number' }], rows: [{ n: 2 }] }; },
    };
    const caller = { pageId: 'page1', subject: null, role: 'anonymous' as const };
    const run = (query: string, variables?: Record<string, unknown>) => executePageOperation({ schema, request: { query, ...(variables ? { variables: variables as HtmlJsonObject } : {}) }, caller, signal, datasets });
    expect(await run('query($p: JSON) { _sql(sql: "select count(*) as n from orders where region = $r", params: $p) { columns { name type } rows } }', { p: { r: 'w' } }))
      .toEqual({ data: { _sql: { columns: [{ name: 'n', type: 'number' }], rows: [{ n: 2 }] } } });
    expect(asked).toEqual([{ sql: 'select count(*) as n from orders where region = $r', params: { r: 'w' } }]);
    const code = async (query: string, variables?: Record<string, unknown>) => (await run(query, variables)).errors?.[0]?.extensions?.code;
    expect(await code('query($p: JSON) { _sql(sql: "select 1", params: $p) { rows } }', { p: { r: { nested: 1 } } })).toBe('validation_failed');
    expect(await code('query($p: JSON) { _sql(sql: "select 1", params: $p) { rows } }', { p: ['w'] })).toBe('validation_failed');
    expect(await code('query($p: JSON) { _sql(sql: "select 1", params: $p) { rows } }', { p: { 'bad-name': 1 } })).toBe('validation_failed');
    expect(await code('query($p: JSON) { _sql(sql: "select 1", params: $p) { rows } }', { p: Object.fromEntries(Array.from({ length: 241 }, (_, i) => [`p${i}`, i])) })).toBe('input_too_large');
    expect(await code('query($s: String!) { _sql(sql: $s) { rows } }', { s: 'x'.repeat(64_001) })).toBe('input_too_large');
    expect(asked).toHaveLength(1);
    // The port's own refusals keep their code.
    const refusing = { ...datasets, sql: async () => { const { GraphQLError } = await import('graphql'); throw new GraphQLError('no', { extensions: { code: 'permission_denied' } }); } };
    expect((await executePageOperation({ schema, request: { query: '{ _sql(sql: "select 1") { rows } }' }, caller, signal, datasets: refusing })).errors).toEqual([{ message: 'no', path: ['_sql'], extensions: { code: 'permission_denied' } }]);
    // `_sql` is a query root: a mutation cannot name it.
    expect((await run('mutation { _sql(sql: "select 1") { rows } }')).errors?.[0]?.message).toMatch(/_sql|Mutation/);
  });
  it('reads flat roots through the dataset port and sends a dataset mutation whole, keyed by root', async () => {
    const schema = composePageSchema([generated('orders')]);
    const calls: unknown[] = [];
    const datasets = {
      queryRoots: () => ({ orders: async (args: { where?: unknown }) => [{ _id: 'r1', region: JSON.stringify(args.where ?? null) }] }),
      mutate: async (request: unknown) => { calls.push(request); return { data: { gone: { affected_rows: 2 } } }; },
      sql: async () => ({ columns: [], rows: [] }),
    };
    const caller = { pageId: 'page1', subject: 'u1', role: 'viewer' as const };
    const read = await executePageOperation({ schema, request: { query: '{ orders(where: {region: {_eq: "w"}}) { _id region } }' }, caller, signal, datasets });
    expect(read.data).toEqual({ orders: [{ _id: 'r1', region: '{"region":{"_eq":"w"}}' }] });
    const write = await executePageOperation({ schema, request: { query: 'mutation { gone: delete_orders(where: {}) { affected_rows } }' }, caller, signal, datasets });
    expect(write).toEqual({ data: { gone: { affected_rows: 2 } }, extensions: { outcomes: { gone: 'committed' } } });
    expect(calls).toEqual([{ query: 'mutation { gone: delete_orders(where: {}) { affected_rows } }' }]);
    const refused = await executePageOperation({ schema, request: { query: 'mutation { delete_orders(where: {}) { affected_rows } }' }, caller, signal, datasets: { ...datasets, mutate: async () => ({ data: null, errors: [{ message: 'no', extensions: { code: 'permission_denied' } }] }) } });
    expect(refused).toEqual({ data: null, errors: [{ message: 'no', extensions: { code: 'permission_denied' } }], extensions: { outcomes: { delete_orders: 'rejected' } } });
  });
});

/**
 * THE BUILT-IN VIEWER: every composed page answers `{ viewer { signedIn id name } }` with no link. Signed in is the
 * caller's page role being at least signed_in (and an account); the name comes from the lazy port only when
 * selected; nothing else about the reader is in the payload. Its root and type names are reserved.
 */
describe('built-in viewer query',()=>{
 const query='{ viewer { signedIn id name } }';
 const run=(caller:{subject:string|null;role:DatasetRole},viewerName?:(subject:string)=>Promise<string|null>,request=query)=>
  executePageOperation({schema:composePageSchema([]),request:{query:request},caller:{pageId:'page1',...caller},signal,...(viewerName?{viewerName}:{})});
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
 it('reads the name only when the query selects it',async()=>{
  let asked=0;
  const result=await executePageOperation({schema:composePageSchema([]),request:{query:'{ me: viewer { signedIn id } }'},caller:{pageId:'page1',subject:'usr_1',role:'viewer'},signal,viewerName:async()=>{asked++;return 'Ada';}});
  expect(result).toEqual({data:{me:{signedIn:true,id:'usr_1'}}});
  expect(asked).toBe(0);
 });
 it('answers a signed-in name as null when no lookup is wired, and is not a mutation root',async()=>{
  expect((await run({subject:'usr_1',role:'signed_in'})).data).toEqual({viewer:{signedIn:true,id:'usr_1',name:null}});
  expect((await run({subject:'usr_1',role:'owner'},undefined,'mutation { viewer { signedIn } }')).errors?.length).toBe(1);
  expect(composePageSchema([]).sdl).toMatch(/type Viewer \{\s+signedIn: Boolean!\s+id: ID\s+name: String\s+"[^"]+"\s+canEdit: Boolean!\s+\}/);
 });
 it('answers canEdit from the page edit port, asked only when selected, for every caller; false without a port',async()=>{
  const asked:string[]=[];
  const exec=(caller:{subject:string|null;role:DatasetRole},answer:boolean|undefined,request:string)=>executePageOperation({schema:composePageSchema([]),request:{query:request},caller:{pageId:'page1',...caller},signal,...(answer===undefined?{}:{canEdit:async()=>{asked.push(caller.role);return answer;}})});
  expect((await exec({subject:'usr_1',role:'editor'},true,'{ viewer { canEdit } }')).data).toEqual({viewer:{canEdit:true}});
  expect((await exec({subject:'usr_2',role:'signed_in'},false,'{ viewer { canEdit } }')).data).toEqual({viewer:{canEdit:false}});
  expect((await exec({subject:null,role:'anonymous'},false,'{ viewer { signedIn canEdit } }')).data).toEqual({viewer:{signedIn:false,canEdit:false}});
  expect((await exec({subject:'usr_1',role:'owner'},undefined,'{ viewer { canEdit } }')).data).toEqual({viewer:{canEdit:false}});
  expect(asked).toEqual(['editor','signed_in','anonymous']);
  expect((await exec({subject:'usr_1',role:'owner'},true,'{ viewer { id } }')).data).toEqual({viewer:{id:'usr_1'}});
  expect(asked).toHaveLength(3);
 });
 it('refuses a dataset generating the viewer root or Viewer type, so nothing can shadow it',()=>{
  const generated=(name:string)=>({name,fileId:`ds_${name}`,version:'live',kind:'dataset-hasura' as const,typeDefs:`type ${name} { _id: ID! }\ntype Query {\n  ${name}: [${name}!]!\n}\n`,roots:{[name]:{table:name,field:'select'}}});
  expect(()=>composePageSchema([generated('viewer')])).toThrow(/graphql_root_collision: link viewer generates viewer, the built-in viewer query/);
  expect(()=>composePageSchema([generated('Viewer')])).toThrow(/graphql_root_collision: link Viewer generates the type Viewer, the built-in viewer query/);
 });
});
