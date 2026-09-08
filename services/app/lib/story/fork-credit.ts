import {getArtifactById} from '@/lib/artifacts';
import {canonicalArtifactPath} from '@/lib/urls';
import {ownerUsername} from '@/lib/users';
import type {ReaderForkedFrom} from './reader-chrome';

/** Provenance is resolved on every read, not cached in the fork's markup.
 * Only PUBLIC sources may be named: unlisted is readable but must not become
 * discoverable through a fork. Private, unlisted and deleted sources have the
 * same projection, containing no source identifier, title or address. */
export async function forkedFromCredit(sourceId:string|null):Promise<ReaderForkedFrom|null>{
  if(!sourceId)return null;
  const source=await getArtifactById(sourceId);
  if(!source||source.visibility!=='public')return {label:'a document that is not public',href:null};
  const href=canonicalArtifactPath(source,await ownerUsername(source.user_id));
  return {label:href.replace(/^\//,''),href};
}
