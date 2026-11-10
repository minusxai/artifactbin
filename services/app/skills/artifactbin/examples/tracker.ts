/**
 * Example: backend functions for examples/tracker.html (linked as data-af-name="tracker"): me says
 *   who reads (the page draws its controls from it); add and save keep each group to LIMIT entries.
 * Usage: node scripts/new-app.mjs --kind tracker [--limit N] copies it as tracker.ts beside the
 *   page; publish it with the page (node scripts/publish.mjs index.html). The page calls
 *   fetch('/fn/me') and, with limits, POSTs /fn/add and /fn/save (an edit or a move). caps.sql
 *   runs as the caller, so the entries rules (own-rows, team) still decide who may add or change
 *   an entry and stamp created_by. Owners and editors bypass rules, so their own entries are left
 *   unstamped.
 * Gotchas: LIMIT must equal APP.limit in the page (--limit N writes both); the page only shows
 *   it, add and save enforce it in ONE statement each (the count and the write together), so
 *   concurrent writes never pass it: the SQL door re-runs a write whose dataset moved. A POST
 *   may write; GET inputs arrive as strings.
 */
interface Caps {
 sql(strings:TemplateStringsArray,...values:unknown[]):Promise<any>;
}
interface Principal { subject:string|null; role:string }
const LIMIT=5; // @only limits
export const roles={add:'signed_in',save:'signed_in'}; // @only limits
// @feature limits
const text=(value:unknown)=>typeof value==='string'?value.trim():'';
/** An entry's fields, bounded as the page's form bounds them. */
function entry(input:{name?:unknown,grp?:unknown,note?:unknown}){
 const name=text(input.name),grp=text(input.grp),note=text(input.note);
 if(!name||name.length>80||!grp||note.length>140)
  throw Error('Give the entry a name (at most 80 characters) and a group');
 return {name,grp,note};
}
// @end limits
export default {
 // GET /fn/me: anyone who can read the page; the role is the reader's role on the page.
 me(_input:unknown,principal:Principal){
  return {signedIn:principal.subject!==null,id:principal.subject,role:principal.role};
 },
 // @feature limits
 // POST /fn/add {name, grp, note}: answers the insert's {affected, returning}, as sql does. The
 // limit is part of the insert: two statements (count, then insert) let concurrent adds pass it.
 async add(input:{name?:unknown,grp?:unknown,note?:unknown},_principal:Principal,caps:Caps){
  const {name,grp,note}=entry(input);
  const added=await caps.sql`insert into entries (name, grp, note) select ${name}, ${grp}, ${note}
   where (select count(*) from entries where grp = ${grp}) < ${LIMIT}`;
  if(!added.affected)throw Error(`${grp} is full (${LIMIT} entries)`);
  return added;
 },
 // POST /fn/save {id, name, grp, note}: an edit, answered as add answers. A move into another
 // group needs room there, checked in the same update; an edit within a group always passes.
 async save(input:{id?:unknown,name?:unknown,grp?:unknown,note?:unknown},_principal:Principal,
  caps:Caps){
  const {name,grp,note}=entry(input),id=text(input.id);
  if(!id)throw Error('Name the entry to save');
  const saved=await caps.sql`update entries set name = ${name}, grp = ${grp}, note = ${note}
   where _id = ${id}
   and (grp = ${grp} or (select count(*) from entries where grp = ${grp}) < ${LIMIT})`;
  if(saved.affected)return saved;
  // Nothing changed: full only if the entry is in another group; else the rules refused it.
  const {rows:[found]}=await caps.sql`select (select grp from entries where _id = ${id}) as was,
   count(*) as size from entries where grp = ${grp}`;
  if(found?.was!=null&&found.was!==grp&&found.size>=LIMIT)
   throw Error(`${grp} is full (${LIMIT} entries)`);
  return saved;
 },
 // @end limits
};
