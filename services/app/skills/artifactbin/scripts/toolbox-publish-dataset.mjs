/**
 * Internal: publish helpers around the send: --template's dataset permissions (applyTemplate)
 * and the counted routine server changes (routineChanges).
 * Used by: toolbox-publish.mjs.
 */
import {readFileSync} from 'node:fs';
import {ToolError} from './toolbox-client.mjs';
/** --type connection: a live dataset from FILE (its connector JSON, no secret) and the secret from
 * --secret-file (- reads stdin). Sent once: never journaled, printed or kept. */
export async function publishConnection(client,file,values){
 const connection=JSON.parse(readFileSync(file,'utf8')),secret=(await client.request(
  '/api/connections')).connectors.find(c=>c.id===connection.connector)?.fields.find(f=>f.secret);
 if(values['secret-file']!==undefined&&secret)connection[secret.name]=readFileSync(values[
  'secret-file']==='-'?0:values['secret-file'],'utf8').trim();
 let destination;if(values.group!==undefined){const g=(await client.request('/api/groups/'+
  encodeURIComponent(values.group.replace(/^@/,'')))).group;destination={type:'group',id:g.id};}
 const made=await client.request('/api/artifacts',{method:'POST',body:{connection,title:values.
  title??file.replace(/^.*\//,'').replace(/\.json$/,''),...destination?{destination}:{}},
  unsafe:true});
 return {id:made.id,url:made.url,ref:`ref:${made.id}`,next:`sql.mjs schema ${made.id}`};
}
export const TEMPLATES=['read-only','own-rows','editors-only'];
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
