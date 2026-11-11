/**
 * PUBLISH RULES for a save's page functions, decided before anything is written (outside the commit, since one of
 * them asks a data service over HTTP):
 *
 * - A `'viewer'` connection name (contracts VIEWER_CONNECTION_KIND) needs a configured data service
 *   (DATA_SERVICES__TRUSTED): without one it is refused (`data_service_not_configured`), so a page can never be
 *   published expecting data nothing can serve.
 * - Republishing a link whose `'viewer'` name already has a binding validates that binding again for the AUTHOR of
 *   this save (lib/data-services `validateViewerBinding`: the service must grant the author a session with those
 *   params), whoever bound it: on a group-owned page, another editor of the group. A first publish has no binding
 *   yet; it is validated when the author sets it.
 * - With `SCHEDULES__PAGE_SCHEDULES=off`, a function schedule the page's current head does not already declare (by
 *   link name and function name) is NEW and refused (`page_schedules_disabled`).
 */
import {parseViewerBinding,VIEWER_CONNECTION_KIND,type HtmlBackendLink,type HtmlPageLink} from '@artifactbin/contracts';
import {getHtmlBackendVersion,type PreparedHtmlBackend} from '@/lib/html-backends';
import {backendSecrets} from '@/lib/html-backend-secrets';
import {json} from '@/lib/http';
import {validateViewerBinding,ViewerBindingError,VIEWER_BINDING_STATUS} from '@/lib/data-services';
import {dataServices,pageSchedulesEnabled} from '@/lib/platform';

export async function pageFunctionPublishRefusal(authorId:string|null|undefined,pageId:string|null,backends:readonly PreparedHtmlBackend[]|undefined,currentLinks:readonly HtmlPageLink[]):Promise<Response|null>{
 if(!backends?.length)return null;
 const viewer=backends.map(backend=>({backend,names:Object.entries(backend.secretHosts??{}).filter(([,kind])=>kind===VIEWER_CONNECTION_KIND).map(([name])=>name)}));
 if(viewer.some(entry=>entry.names.length)&&!dataServices().length)return json({error:'data_service_not_configured',details:viewer.flatMap(({backend,names})=>names.map(name=>`resolver "${backend.name}" declares ${name}: 'viewer', a connection a data service opens as each viewer; this server has no data service configured (DATA_SERVICES__TRUSTED)`))},400);
 const prior=(name:string)=>currentLinks.find(link=>link.kind==='backend'&&link.name===name) as HtmlBackendLink|undefined;
 if(!pageSchedulesEnabled()){
  for(const backend of backends){
   if(!backend.schedule||!Object.keys(backend.schedule).length)continue;
   const link=prior(backend.name);
   const before=link?(await getHtmlBackendVersion(link.backendId,link.version))?.schedule??{}:{};
   const added=Object.keys(backend.schedule).filter(name=>!Object.hasOwn(before,name));
   if(added.length)return json({error:'page_schedules_disabled',details:added.map(name=>`resolver "${backend.name}" schedules ${name}: page schedules are off on this server (SCHEDULES__PAGE_SCHEDULES); drop the schedule export (call the function on demand instead)`)},409);
  }
 }
 if(!authorId||!pageId)return null;
 for(const {backend,names} of viewer){
  const link=prior(backend.name);
  if(!link)continue;
  // The binding is stored under the backend's owner (the page's owner, or its owning group), not under whoever saves.
  const ownerId=(await getHtmlBackendVersion(link.backendId,link.version))?.ownerId;
  if(!ownerId)continue;
  for(const name of names){
   let stored:string;
   try{stored=await backendSecrets.get({ownerId,backendId:link.backendId},[name],name);}catch{continue;}
   try{await validateViewerBinding(authorId,parseViewerBinding(JSON.parse(stored)),pageId);}
   catch(error){
    const code=error instanceof ViewerBindingError?error.code:'invalid_binding';
    return json({error:code,details:[`resolver "${backend.name}" connection ${name}: its binding no longer validates for you (${code}); set it again or remove it`]},error instanceof ViewerBindingError?VIEWER_BINDING_STATUS[error.code]:403);
   }
  }
 }
 return null;
}
