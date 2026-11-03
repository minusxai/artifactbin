/**
 * Internal: publish helpers around the send: --template's dataset permissions (applyTemplate),
 * deprecated legacy dataset links (legacyDatasetLinks) and the counted routine server changes
 * (routineChanges).
 * Used by: toolbox-publish.mjs.
 */
import {ToolError} from './toolbox-client.mjs';
export const TEMPLATES=['read-only','own-rows','editors-only'];
/** The shapes only the legacy dataset namespace has; a link without data-af-api on such a page
 * stays on it, as the server decides (lib/html-page resolveDatasetApis). */
const LEGACY_QUERY=/\bschema\s*\{\s*(?:revision|tables)\b|\brows\s*\(\s*tableId\b|\bwriteRows\s*\(/;
/** Names of the page's dataset links that mount the legacy API: data-af-api="legacy", or no
 * data-af-api on a page written against the legacy shapes. */
export function legacyDatasetLinks(html){
 const legacyQueries=LEGACY_QUERY.test(html),names=[];
 for(const [tag] of String(html??'').matchAll(/<link\b[^>]*>/gi)){
  if(!/\brel\s*=\s*["'][^"']*\baf-dataset\b/i.test(tag))continue;
  const name=tag.match(/\sdata-af-name\s*=\s*["']([^"']+)["']/i)?.[1],api=tag.match(
   /\sdata-af-api\s*=\s*["']([^"']+)["']/i)?.[1];
  if(name&&(api==='legacy'||api===undefined&&legacyQueries))names.push(name);
 }
 return names;
}
/** --template: the named starting permissions, applied right after the dataset is created. */
export async function applyTemplate(client,id,name,owner){
 const route=`/api/artifacts/${id}/policy`,listed=await client.request(`${route}/templates${owner?
  '?ownerColumn='+encodeURIComponent(owner):''}`),found=listed.templates.find(t=>t.name===name);
 if(!found?.ok)throw new ToolError('invalid_template',
  `Dataset ${id} was created, but the ${name} template does not fit it; its permissions are `+
  'unchanged.',
  2,`Fix details.errors, then policy.mjs template ${name} ${id} … and policy.mjs set.`,
  {id,errors:found?.errors??[]});
 const saved=await client.request(route,{method:'PUT',body:{policy:found.policy,
  expectedPolicyRevision:listed.revision},unsafe:true,safeToRepeat:false});
 return {template:name,revision:saved.revision,readBack:String(saved.readBack??'').split('\n')
  .filter(Boolean)};
}
/** Platform-owned changes the server made on publish, counted rather than listed: identities and
 * asset links. */
export function routineChanges(sent,saved,identity,baseline){
const count=text=>(text.match(/\sdata-af-id\s*=/g)??[]).length,added=count(saved)-count(sent),
   changes=[];
if(identity&&identity.carried)changes.push(
   `carried forward ${identity.carried} data-af-id from v${identity.fromVersion}, ${
     identity.fresh} new`);
 else if(added>0)changes.push(`added ${added} data-af-id`);
const links=text=>[...text.matchAll(/\s(?:src|href|poster)\s*=\s*"([^"]*)"/g)].map(match=>match[1]),
   before=links(sent),after=links(saved);
if(before.length===after.length){const rewritten=before.filter((value,index)=>value!==after[
   index]).length;if(rewritten)changes.push(`rewrote ${rewritten} asset link${rewritten===1?'':
   's'}`);}
 return changes;
}
