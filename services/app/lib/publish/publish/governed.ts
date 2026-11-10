/**
 * COMBINED-MODE PUBLISH RULES for a save's page functions, decided before anything is written (outside the commit,
 * since two of them ask MinusX over HTTP):
 *
 * - A `'minusx'` connection name (contracts MINUSX_CONNECTION_KIND) needs combined mode: standalone refuses it
 *   (`minusx_not_configured`), so a page can never be published expecting governed data nothing can serve.
 * - Republishing a link whose `'minusx'` name already has a binding validates that binding again for the AUTHOR of
 *   this save (lib/minusx `validateMinusxBinding`: direct member of the pinned group, and the connection visible to
 *   it through MinusX). A first publish has no binding yet; it is validated when the author sets it.
 * - With `SCHEDULES__OWNER=minusx`, a function schedule the page's current head does not already declare (by link
 *   name and function name) is NEW and refused (`schedules_owned_by_minusx`): MinusX owns recurring work there.
 */
import {MINUSX_CONNECTION_KIND,type HtmlBackendLink,type HtmlPageLink} from '@artifactbin/contracts';
import {getHtmlBackendVersion,type PreparedHtmlBackend} from '@/lib/html-backends';
import {backendSecrets} from '@/lib/html-backend-secrets';
import {json} from '@/lib/http';
import {minusxBinding,MinusxBindingError,validateMinusxBinding} from '@/lib/minusx';
import {minusxSettings,schedulesOwner} from '@/lib/platform';

const BINDING_STATUS:Record<string,number>={minusx_not_configured:400,minusx_unavailable:503};

export async function governedPublishRefusal(authorId:string|null|undefined,backends:readonly PreparedHtmlBackend[]|undefined,currentLinks:readonly HtmlPageLink[]):Promise<Response|null>{
 if(!backends?.length)return null;
 const governed=backends.map(backend=>({backend,names:Object.entries(backend.secretHosts??{}).filter(([,kind])=>kind===MINUSX_CONNECTION_KIND).map(([name])=>name)}));
 if(governed.some(entry=>entry.names.length)&&!minusxSettings())return json({error:'minusx_not_configured',details:governed.flatMap(({backend,names})=>names.map(name=>`resolver "${backend.name}" declares ${name}: 'minusx', a governed MinusX connection; this server has no MinusX configured (MINUSX__BASE_URL)`))},400);
 const prior=(name:string)=>currentLinks.find(link=>link.kind==='backend'&&link.name===name) as HtmlBackendLink|undefined;
 if(schedulesOwner()==='minusx'){
  for(const backend of backends){
   if(!backend.schedule||!Object.keys(backend.schedule).length)continue;
   const link=prior(backend.name);
   const before=link?(await getHtmlBackendVersion(link.backendId,link.version))?.schedule??{}:{};
   const added=Object.keys(backend.schedule).filter(name=>!Object.hasOwn(before,name));
   if(added.length)return json({error:'schedules_owned_by_minusx',details:added.map(name=>`resolver "${backend.name}" schedules ${name}: recurring work on this installation is scheduled in MinusX, not by a page; drop the schedule export (call the function on demand instead)`)},409);
  }
 }
 if(!authorId)return null;
 for(const {backend,names} of governed){
  const link=prior(backend.name);
  if(!link)continue;
  for(const name of names){
   let stored:string;
   try{stored=await backendSecrets.get({ownerId:authorId,backendId:link.backendId},[name],name);}catch{continue;}
   try{await validateMinusxBinding(authorId,minusxBinding(JSON.parse(stored)));}
   catch(error){
    const code=error instanceof MinusxBindingError?error.code:'invalid_binding';
    return json({error:code,details:[`resolver "${backend.name}" connection ${name}: its MinusX binding no longer validates for you (${code}); set it again or remove it`]},BINDING_STATUS[code]??403);
   }
  }
 }
 return null;
}
