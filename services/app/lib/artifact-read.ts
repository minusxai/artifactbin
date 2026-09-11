import {effectiveRole,getArtifactById,getArtifactFor,type TokenActor} from './artifacts';
import {canRead,canEdit,canAnnotate} from './share-roles';
import {artifactToWireWithAnnotations} from './artifact-wire';
import {publicCatalogOf} from './datasets/catalog';

/** Read access never implies access to the editable governance or connection definition. */
export async function readableArtifact(actor:TokenActor,id:string){
 const row=await getArtifactById(id);
 if(!row)return null;
 const role=await effectiveRole(row,actor);
 return canRead(role)?{row,role}:null;
}

export async function readArtifactSnapshot(actor:TokenActor,id:string,base:string){
 const readable=await readableArtifact(actor,id);if(!readable)return null;
 const {row,role}=readable;const editable=canEdit(role);
 // Recheck the edit predicate in the query that reads the invitation snapshot.
 const snapshot=editable?await getArtifactFor(actor,id):row;
 if(!snapshot)return null;
 const wire:Record<string,unknown>=await artifactToWireWithAnnotations(snapshot,base);
 if(!editable){
  for(const field of ['shares','dataset_policy','policy_revision','sharing_revision','actor_user_id','actor_token_id'])delete wire[field];
  if(row.format==='dataset'){
   wire.markup=null;
   wire.meta={catalog:publicCatalogOf(row)};
  }
 }
 return {...wire,capabilities:{mutation_receipts:true,read:true,edit:editable,comment:canAnnotate(role),sharing:editable,delete:role==='owner',restore:role==='owner'}};
}
