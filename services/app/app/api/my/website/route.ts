import {browserActor} from '@/lib/authentication';
import {json,readJson,unauthorized} from '@/lib/http';
import {deleteSiteRoot,saveSiteRoot,validSiteLabel,websiteSettings} from '@/lib/user-pages';

async function settings(request:Request) {
  const actor=await browserActor(request);
  if(actor instanceof Response)return actor;
  if(actor.credential!=='session'||!actor.userId)return unauthorized(request);
  if(request.method==='GET')return json(await websiteSettings(actor.userId),200,{'Cache-Control':'no-store'});
  const body=await readJson(request);
  const label=body?.subdomain_label;
  if(typeof label!=='string'||(label!==''&&!validSiteLabel(label)))return json({error:'invalid_subdomain_label'},400);
  if(request.method==='DELETE'){
    if(!label)return json({error:'main_site_required'},400);
    await deleteSiteRoot(actor.userId,label);
  } else {
    const folderId=body?.folder_id;
    if(folderId!==null && typeof folderId!=='string')return json({error:'invalid_folder'},400);
    if(!await saveSiteRoot(actor.userId,label,folderId))return json({error:'folder_not_found'},404);
  }
  return json({ok:true});
}
export {settings as GET,settings as PUT,settings as DELETE};
