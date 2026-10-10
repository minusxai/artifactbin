import {z} from 'zod';
import type {DocumentGraph,DocumentResourcePreparation,RunnerJson} from '@artifactbin/contracts';
import type { TokenActor } from '@/lib/accounts';
import { getEditableArtifactFor } from '@/lib/artifacts';
import {OPERATIONS} from './registry';
import {runOperation} from './http';
import {json} from '../http/http';
import {prepareClientDocument} from '../document/document-update-client';
import {prepareDocumentAuthoringContext} from '@/lib/publish/publish/document-authoring-context';

const names=['create_artifact','get_artifact','list_artifacts','query_resource','mutate_dataset'];
const editInput=z.object({
 id:z.string().describe('Artifact ID from your read or creation result'),
 edit_id:z.string().describe('Observed edit_id from your most recent read; reread and reconcile if the document changed'),
 markup:z.string().describe('Complete revised JSX source. Preserve existing node IDs and content you are not changing'),
});
/** Model schemas come from the real API. The sole convenience tool hides the
 * same authoring compiler used by afbin; it does not introduce a write protocol. */
export function hostedOperationTools():Array<{name:string;description:string;parameters:RunnerJson}> {
 return [...names.map(name=>{
  const spec=OPERATIONS.find(operation=>operation.name===name)!;
  return {name,description:spec.description,parameters:z.toJSONSchema(z.object(spec.input),{io:'input'}) as RunnerJson};
 }),{name:'edit_document',description:'Edit a JSX document after reading it. Send the observed edit_id and complete revised markup. The host compiles an atomic update with normal validation and permissions. On doc_changed, read again and preserve intervening edits.',parameters:z.toJSONSchema(editInput) as RunnerJson}];
}

export async function editHostedDocument(request:Request,actor:TokenActor,input:Record<string,unknown>):Promise<Response> {
 const parsed=editInput.safeParse(input);
 if(!parsed.success)return json({error:'invalid_operation_input',details:parsed.error.issues},400);
 const {id,edit_id,markup}=parsed.data;
 const snapshot=await getEditableArtifactFor(actor,id);
 if(!snapshot)return json({error:'not_found'},404);
 if(snapshot.format!=='markup'||!snapshot.document)return json({error:'not_a_document'},400);
 if(snapshot.edit_id!==edit_id)return json({error:'doc_changed',detail:'Read the document again and reconcile your changes before retrying.'},409);
 try {
  const prepared=prepareClientDocument({document:snapshot.document as DocumentGraph,version:snapshot.version as number,meta:(snapshot.meta??{}) as Record<string,unknown>,title:snapshot.title as string|null,description:snapshot.description as string|null},{source:markup});
  if(prepared.context){
   const response=await prepareDocumentAuthoringContext(actor,id,{source:prepared.context});
   if(!response.ok)return response;
   const resources=await response.json() as DocumentResourcePreparation;
   if(resources.datasetBindings?.length)prepared.update.datasetBindings=resources.datasetBindings;
  }
  return runOperation('edit_artifact',request,actor,{id,edit_id,document_update:prepared.update});
 } catch(error) {
  return json({error:'invalid_document',detail:error instanceof Error?error.message:'Document preparation failed'},400);
 }
}
