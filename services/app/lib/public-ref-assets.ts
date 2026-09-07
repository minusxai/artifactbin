import {canReadArtifact,getArtifactById} from '@/lib/artifacts';
import {ID_RE} from '@/lib/ids';
import type {WebAssetKind} from '@/lib/web-assets';

/** Anonymous-readable files only. A document's own read grant, login, token or
 * export key never widens the referenced file's audience. Recheck per read. */
export async function publicRefAsset(id:string,kind:WebAssetKind='binary') {
  if(!ID_RE.test(id))return null;
  const row=await getArtifactById(id);
  if(!row || !['file','image','pdf'].includes(row.format) || !await canReadArtifact(row,null))return null;
  const type=(row.meta as {contentType?:string})?.contentType ?? 'application/octet-stream';
  if(kind !== 'binary' && !(kind==='image'?type.startsWith('image/'):kind==='font'?type.startsWith('font/'):kind==='pdf'?type==='application/pdf':['text/javascript','application/javascript'].includes(type)))return null;
  return row;
}
