/** Runtime reference resolution never inherits the containing document's ownership. */
import { canReadArtifact } from './access';
import type { Viewer } from '@/lib/accounts';
import { getArtifactById } from './store';
import { imageReferenceId, imageRefData, type ImageRefData } from '@/lib/dataflow';

export async function resolveImageReference(value:string,actor:{viewer:Viewer;tokenId:string|null},capture=false):Promise<ImageRefData|null> {
 const id=imageReferenceId(value);if(!id)return null;
 const row=await getArtifactById(id);
 if(!row||row.format!=='image'||!(actor.tokenId===row.token_id||await canReadArtifact(row,actor.viewer)))return null;
 return imageRefData(row,capture);
}
