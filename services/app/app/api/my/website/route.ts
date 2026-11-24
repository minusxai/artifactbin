import {browserActor} from '@/lib/authentication';
import {json,readJson,unauthorized} from '@/lib/http';
import {deleteSiteRoot,saveSiteRoot,websiteSettings} from '@/lib/user-pages';

async function settings(request:Request) {
  const actor=await browserActor(request);
  if(actor instanceof Response)return actor;
  if(actor.credential!=='session'||!actor.userId)return unauthorized(request);
  if(request.method==='GET')return json(await websiteSettings(actor.userId),200,{'Cache-Control':'no-store'});
  const body=await readJson(request);
  const label=body?.subdomain_label;
  if(typeof label!=='string')return json({error:'invalid_subdomain_label'},400);
  const expected=body?.expected_folder_id;
  if(expected!==undefined && expected!==null && typeof expected!=='string')return json({error:'invalid_folder'},400);
  if(request.method==='DELETE'){
    if(!label)return json({error:'main_site_required'},400);
    if(!await deleteSiteRoot(actor.userId,label,expected))return json({error:'site_conflict'},409);
  } else {
    const folderId=body?.folder_id;
    if(folderId!==null && typeof folderId!=='string')return json({error:'invalid_folder'},400);
    const result=await saveSiteRoot(actor.userId,label,folderId,expected);
    if(result!=='saved')return json({error:result},result==='site_conflict'?409:result==='folder_not_found'?404:400);
  }
  return json({ok:true});
}
export {settings as GET,settings as PUT,settings as DELETE};
