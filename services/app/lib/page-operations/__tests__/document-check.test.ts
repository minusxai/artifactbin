/**
 * THE PUBLISH DOCUMENT CHECK (document-check.ts): the GraphQL documents a resolver passes to `caps.query`, and the
 * page's own static `gql` documents, validated against the page's names. A dataset field written under the dataset's
 * own name (what `graphql.mjs schema DATASET_ID` shows) names its page-name replacement; other unknown roots list the
 * closest names. Anything dynamic, unparsable or local-state is never reported.
 */
import { expect, it } from 'vitest';
import { pageDocumentProblems, type PageDocumentCheck } from '@/lib/page-operations';

const NOTES_SDL = `
type notes { _id: ID! note: String deal: String }
input notes_bool_exp { note: String_comparison_exp }
input String_comparison_exp { _eq: String }
input notes_insert_input { note: String deal: String }
type notes_mutation_response { affected_rows: Int! }
type Query {
  notes(where: notes_bool_exp, limit: Int): [notes!]!
  notes_by_pk(_id: ID!): notes
}
type Mutation {
  insert_notes(objects: [notes_insert_input!]!): notes_mutation_response
  insert_notes_one(object: notes_insert_input!): notes
  delete_notes(where: notes_bool_exp!): notes_mutation_response
}
`;
const own = ['', '_bool_exp', '_insert_input', '_mutation_response', '_by_pk'].map((suffix) => [`deal_notes${suffix}`, `notes${suffix}`] as const);
const RENAMES = Object.fromEntries([...own, ...['insert', 'delete'].map((verb) => [`${verb}_deal_notes`, `${verb}_notes`]), ['insert_deal_notes_one', 'insert_notes_one']]);
const BUDGET_SDL = 'type Query { total: Float! }\ntype Mutation { addNote(note: String!): Boolean! @auth(role: signed_in) }';

const check = (over: Partial<PageDocumentCheck>): PageDocumentCheck => ({
  datasetSdl: NOTES_SDL,
  datasets: [{ name: 'notes', fileId: 'dsNotes1', version: 'live', typeDefs: NOTES_SDL, renames: RENAMES }],
  backends: [{ name: 'deals', typeDefs: BUDGET_SDL }],
  resolvers: [],
  scripts: [],
  ...over,
});
const resolver = (source: string) => ({ label: 'resolver deals.ts', source });
const TRACE = `export const typeDefs='type Mutation { addNote(note:String!):Boolean! }';
export default { async addNote(args:{note:string}, _p:unknown, caps:any) {
  await caps.query('mutation Add($o: deal_notes_insert_input!){ insert_deal_notes_one(object:$o){_id} }', {o:{note:args.note}});
  return true;
} };`;

it('names the page-name replacement for a dataset field written under its own name (the eval trace)', async () => {
  expect(await pageDocumentProblems(check({ resolvers: [resolver(TRACE)] }))).toEqual([
    'resolver deals.ts: insert_deal_notes_one is not on this page; the dataset is linked as "notes": use insert_notes_one (and notes_insert_input)',
  ]);
});

it('follows a module-level const the call names, as the shared-app resolver writes them', async () => {
  const source = `const FIND=\`query Find($n:String!){deal_notes(where:{note:{_eq:$n}}){_id}}\`;
const OK=\`mutation Add($o:notes_insert_input!){insert_notes_one(object:$o){_id}}\`;
export const typeDefs='type Query { x: Int }';
export default { async x(_a:unknown,_p:unknown,caps:{query(q:string,v?:object):Promise<any>}){ await caps.query(OK,{}); return (await caps.query(FIND,{n:'a'})).deal_notes.length; } };`;
  expect(await pageDocumentProblems(check({ resolvers: [resolver(source)] }))).toEqual([
    'resolver deals.ts: deal_notes is not on this page; the dataset is linked as "notes": use notes',
  ]);
});

it('publishes clean documents, and lists the closest names for an unknown field with no rename', async () => {
  const clean = `export default { async x(_a:unknown,_p:unknown,caps:any){
    await caps.query("query { notes(limit: 2) { _id note } }");
    await caps.query(\`mutation M($o:[notes_insert_input!]!){ insert_notes(objects:$o){ affected_rows } }\`, {o:[]});
  } };`;
  expect(await pageDocumentProblems(check({ resolvers: [resolver(clean)] }))).toEqual([]);
  const typo = `export default { async x(_a:unknown,_p:unknown,caps:any){ await caps.query('mutation { insert_note_one(object:{note:"a"}){ _id } }'); } };`;
  expect(await pageDocumentProblems(check({ resolvers: [resolver(typo)] }))).toEqual([
    'resolver deals.ts: insert_note_one is not on this page; closest: insert_notes_one, insert_notes, delete_notes',
  ]);
  const column = `export default { async x(_a:unknown,_p:unknown,caps:any){ await caps.query('{ notes { _id title } }'); } };`;
  expect(await pageDocumentProblems(check({ resolvers: [resolver(column)] }))).toEqual([
    'resolver deals.ts: Cannot query field "title" on type "notes". Did you mean "note"?',
  ]);
});

it('skips anything dynamic, unparsable, or not a caps.query call', async () => {
  const dynamic = `const root='deal_notes';let LATER='{ deal_notes { _id } }';
export default { async x(a:{q:string},_p:unknown,caps:any,db:any){
  await caps.query(\`{ \${root} { _id } }\`);
  await caps.query(a.q);
  await caps.query(LATER);
  await caps.query('{ deal_notes { _id ');
  await db.query('{ deal_notes { _id } }');
  await caps.sql('SELECT * FROM deal_notes');
  await caps.fetch('https://api.example.com/graphql', { method: 'POST', body: JSON.stringify({ query: '{ deal_notes { _id } }' }) });
} };`;
  expect(await pageDocumentProblems(check({ resolvers: [resolver(dynamic)] }))).toEqual([]);
  expect(await pageDocumentProblems(check({ resolvers: [resolver('export default {')] }))).toEqual([]);
  // No linked dataset: caps.query has nothing to read, and nothing is checked.
  expect(await pageDocumentProblems(check({ datasetSdl: null, datasets: [], resolvers: [resolver(TRACE)] }))).toEqual([]);
});

it('checks the page\'s static gql documents against the composed page schema, never its local state', async () => {
  const script = (body: string) => `import {client,gql} from '@afbin/apollo';\n${body}`;
  const valid = script(`const local=gql\`{dark month category}\`;
const rows=gql\`query Rows($n:Int!,$m:String){ notes(limit:$n){ _id note } viewer { signedIn } month }\`;
const add=gql\`mutation A($c:String!){ deals { addNote(note:$c) } }\`;
const dyn=gql([\`{ \${window.APP.dataset} { _id } }\`]);
const plain=gql\`{ deal_notes { _id } }\`;`);
  expect(await pageDocumentProblems(check({ scripts: [valid] }))).toEqual([]);
  const wrong = script(`const one=gql\`mutation { insert_deal_notes_one(object:{note:"x"}){ _id } }\`;
const read=gql\`{ deal_notes(limit: 3) { _id } }\`;
const field=gql([\`{ notes { _id titel } }\`]);
const call=gql\`mutation { deals { addNot(note:"x") } }\`;`);
  expect(await pageDocumentProblems(check({ scripts: [wrong] }))).toEqual([
    'page: insert_deal_notes_one is not on this page; the dataset is linked as "notes": use insert_notes_one',
    'page: deal_notes is not on this page; the dataset is linked as "notes": use notes',
    'page: Cannot query field "titel" on type "notes". Did you mean "note"?',
    'page: Cannot query field "addNot" on type "deals__Mutation". Did you mean "addNote"?',
  ]);
  // A page that registers local mutations may name any mutation field locally.
  const local = script(`client.addResolvers({Mutation:{insert_deal_notes_one:(draft)=>{}}});
const one=gql\`mutation { insert_deal_notes_one(object:{note:"x"}){ _id } }\`;`);
  expect(await pageDocumentProblems(check({ scripts: [local] }))).toEqual([]);
  // A resolver link whose schema is not in hand (not part of this save) is skipped, never guessed.
  expect(await pageDocumentProblems(check({ backends: [], unchecked: ['deals'], scripts: [script('gql`mutation { deals { addNot(note:"x") } }`;')] }))).toEqual([]);
});
