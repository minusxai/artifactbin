/** Runtime reference resolution never inherits the containing document's ownership. */
import { ownsArtifact,canReadArtifact } from './access';
import type { Viewer } from '@/lib/accounts';
import { getArtifactById } from './rows';
import { imageReferenceId, imageRefData, type ImageRefData } from '@/lib/dataflow';

export async function resolveImageReference(value:string,actor:{viewer:Viewer;tokenId:string|null},capture=false):Promise<ImageRefData|null> {
 const id=imageReferenceId(value);if(!id)return null;
 const row=await getArtifactById(id);
 if(!row||row.format!=='image'||!(ownsArtifact(row,{tokenId:actor.tokenId,userId:actor.viewer?.userId??null})||await canReadArtifact(row,actor.viewer)))return null;
 return imageRefData(row,capture);
}
