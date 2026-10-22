import type { CompiledDatasetMutation } from "./dataset-mutations-contracts.ts";
import { compiledDatasetMutationDocument } from "./dataset-mutations.ts";
export function datasetMutationBoot(
  bindings: readonly CompiledDatasetMutation[],
  hasImports: boolean,
): string {
  const documents = Object.fromEntries(
    [...new Set(bindings.map((b) => b.backendNamespace))].map((name) => [
      name,
      compiledDatasetMutationDocument(name),
    ]),
  );
  return `const mutationBindings=${JSON.stringify(bindings)};
 const mutationDocuments=Object.fromEntries(Object.entries(${JSON.stringify(documents)}).map(([name,source])=>[name,gql(Object.assign([source],{raw:[source]}))]));
 const [mutationTick,setMutationTick]=createSignal(0);
 const mutationAdapter=createCompiledDatasetMutations({bindings:mutationBindings,client,documents:mutationDocuments,intentStore:compiledMutationIntentStore(client,gql\`{ datasetMutationIntents }\`),authorizationContext:()=>client.authorizationContext(),requestId:()=>crypto.randomUUID(),values,reset:names=>write(Object.fromEntries(names.map(name=>[name,declarations.find(d=>d.name===name).default]))),committed:()=>{${hasImports ? "refreshDatasets();" : "void run();"}}});
 const mutationStatus=document.createElement('div');mutationStatus.setAttribute('role','status');document.body.append(mutationStatus);
 const renderMutations=()=>{setMutationTick(n=>n+1);mutationStatus.replaceChildren();for(const binding of mutationBindings){const status=mutationAdapter.status(binding.name);if(!status)continue;const message=document.createElement('p');message.textContent=({pending:'Saving shared data…',committed:'Shared data saved.',rejected:'Shared data save rejected.',offline:'Offline. Shared data was not saved.',unknown:'The save outcome is unknown. Reconcile it before saving again.'})[status.state];mutationStatus.append(message);if(status.state==='unknown'){const retry=document.createElement('button');retry.type='button';retry.textContent='Reconcile save';retry.addEventListener('click',()=>{void mutationAdapter.retry(binding.name).catch(()=>{});});mutationStatus.append(retry);}}};
 const stopMutations=mutationAdapter.subscribe(renderMutations);renderMutations();
 store.mutate=(name,args,row)=>{if(row&&Object.keys(row).length)return Promise.reject(Error('Row-dependent mutations are unavailable'));return mutationAdapter.mutate(name,args);};
 window.addEventListener('pagehide',event=>{if(!event.persisted)stopMutations();});`;
}
