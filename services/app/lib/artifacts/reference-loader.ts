/** Native asset admission resolves within the actor scope, then ordinary link access. */
import type {AccessActor} from '@/lib/accounts';
import {getArtifactFor,getLinkReadableArtifact} from './rows';
import type {ServerRefLoader} from '@/lib/datasets';
export function refLoaderForActor(actor:AccessActor):ServerRefLoader{
 return async id=>{const row=await getArtifactFor(actor,id)??await getLinkReadableArtifact(id);return row?{id:row.id,format:row.format}:null;};
}
