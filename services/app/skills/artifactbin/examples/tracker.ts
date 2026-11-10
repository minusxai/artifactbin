/**
 * Example: backend functions for examples/tracker.html (linked as data-af-name="tracker"): me says
 *   who reads (the page draws its controls from it); add keeps each group to LIMIT entries.
 * Usage: node scripts/new-app.mjs --kind tracker [--limit N] copies it as tracker.ts beside the
 *   page; publish it with the page (node scripts/publish.mjs index.html). The page calls
 *   fetch('/fn/me') and, with limits, fetch('/fn/add', {method: 'POST', body}). caps.sql runs as
 *   the caller, so the entries rules (own-rows, team) still decide who may add, and the owner
 *   column is stamped as usual.
 * Gotchas: LIMIT must equal APP.limit in the page (--limit N writes both); the page only shows
 *   it, add enforces it in ONE statement (the count and the insert together), so concurrent adds
 *   never pass it: the SQL door re-runs a write whose dataset moved. A POST may write; GET inputs
 *   arrive as strings.
 */
interface Caps {
 sql(strings:TemplateStringsArray,...values:unknown[]):Promise<any>;
}
interface Principal { subject:string|null; role:string }
const LIMIT=5; // @only limits
export const roles={add:'signed_in'}; // @only limits
export default {
 // GET /fn/me: anyone who can read the page; the role is the reader's role on the page.
 me(_input:unknown,principal:Principal){
  return {signedIn:principal.subject!==null,id:principal.subject,role:principal.role};
 },
 // @feature limits
 // POST /fn/add {name, grp, note}: answers the insert's {affected, returning}, as sql does. The
 // limit is part of the insert: two statements (count, then insert) let concurrent adds pass it.
 async add(input:{name?:unknown,grp?:unknown,note?:unknown},_principal:Principal,caps:Caps){
  const text=(value:unknown)=>typeof value==='string'?value.trim():'';
  const name=text(input.name),grp=text(input.grp),note=text(input.note);
  if(!name||name.length>80||!grp||note.length>140)
   throw Error('Give the entry a name (at most 80 characters) and a group');
  const added=await caps.sql`insert into entries (name, grp, note) select ${name}, ${grp}, ${note}
   where (select count(*) from entries where grp = ${grp}) < ${LIMIT}`;
  if(!added.affected)throw Error(`${grp} is full (${LIMIT} entries)`);
  return added;
 },
 // @end limits
};
