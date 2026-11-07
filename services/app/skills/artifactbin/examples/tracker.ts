/**
 * Example: resolver for examples/tracker.html's limits feature (linked as data-af-name="tracker"):
 *   adds an entry only while its group holds fewer than LIMIT entries.
 * Usage: node scripts/new-app.mjs --kind tracker [--limit N] copies it as tracker.ts beside the
 *   page; publish it with the page (node scripts/publish.mjs index.html). caps.query and caps.sql
 *   run as the caller, so the entries rules (own-rows, team) still decide who may add, and the
 *   owner column is stamped as usual.
 * Gotchas: LIMIT must equal APP.limit in the page (--limit N writes both); the page only shows
 *   it, this enforces it. The count is read-only SQL (caps.sql), never GraphQL aggregation.
 */
interface Caps {
 query(graphql:string,variables?:Record<string,unknown>):Promise<any>;
 sql(sql:string,params?:Record<string,unknown>):Promise<{rows:Array<Record<string,any>>}>;
}
const LIMIT=5;
export const typeDefs=`
 type Added { _id:ID! }
 type Mutation { add(name:String!,grp:String!,note:String):Added! @auth(role:signed_in) }
`;
const COUNT='select count(*) as n from entries where grp = $g';
const INSERT=`mutation Insert($o:entries_insert_input!){insert_entries_one(object:$o){_id}}`;
export default {
 async add(args:{name:string,grp:string,note?:string|null},_principal:unknown,caps:Caps){
  const name=args.name.trim(),grp=args.grp.trim(),note=(args.note??'').trim();
  if(!name||name.length>80||!grp||note.length>140)
   throw Error('Give the entry a name (at most 80 characters) and a group');
  const [row]=(await caps.sql(COUNT,{g:grp})).rows;
  if(Number(row?.n??0)>=LIMIT)throw Error(`${grp} is full (${LIMIT} entries)`);
  return (await caps.query(INSERT,{o:{name,grp,note}})).insert_entries_one;
 }
};
