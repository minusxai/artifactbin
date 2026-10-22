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
 const availabilityDocuments=Object.fromEntries(Object.entries(${JSON.stringify(Object.fromEntries([...new Set(bindings.map((b) => b.backendNamespace))].map((name) => [name, `query CellMutationAvailability($operation:String!){${name}{mutationAvailability(operation:$operation){canAttempt}}}`])))}).map(([name,source])=>[name,gql(Object.assign([source],{raw:[source]}))]));
 ${bindings.length > 0 ? ` const cellAvailability=createCompiledMutationAvailability({bindings:mutationBindings,watch:(binding,next)=>{const subscription=client.watchQuery({query:availabilityDocuments[binding.backendNamespace],variables:{operation:binding.name},clearOnRefresh:true}).subscribe(result=>next(result.errors?.length?undefined:result.data?.[binding.backendNamespace]?.mutationAvailability));return()=>subscription.unsubscribe();},changed:()=>setMutationTick(n=>n+1)});` : "const cellAvailability={unavailable:()=>null,reconnect:()=>{},dispose:()=>{}};"}
 const mutationAdapter=createCompiledDatasetMutations({bindings:mutationBindings,client,documents:mutationDocuments,intentStore:compiledMutationIntentStore(client,gql\`{ datasetMutationIntents }\`),authorizationContext:()=>client.authorizationContext(),requestId:()=>crypto.randomUUID(),values,reset:names=>write(Object.fromEntries(names.map(name=>[name,declarations.find(d=>d.name===name).default]))),committed:()=>{${hasImports ? "refreshDatasets();" : "void run();"}}});
 const mutationStatus=document.createElement('div');mutationStatus.setAttribute('role','status');document.body.append(mutationStatus);
 const renderMutations=()=>{setMutationTick(n=>n+1);mutationStatus.replaceChildren();for(const binding of mutationBindings){const status=mutationAdapter.status(binding.name);if(!status)continue;const message=document.createElement('p');message.textContent=({pending:'Saving shared data…',committed:'Shared data saved.',rejected:'Shared data save rejected.',offline:'Offline. Shared data was not saved.',unknown:'The save outcome is unknown. Reconcile it before saving again.'})[status.state];mutationStatus.append(message);if(status.state==='unknown'){const retry=document.createElement('button');retry.type='button';retry.textContent='Reconcile save';retry.addEventListener('click',()=>{void mutationAdapter.retry(binding.name).catch(()=>{});});mutationStatus.append(retry);}}};
 const stopMutations=mutationAdapter.subscribe(renderMutations);renderMutations();
 store.authorizationContext=()=>client.authorizationContext();
 store.mutationState=name=>{mutationTick();return mutationAdapter.status(name)?.state??null;};
 store.reconcileMutation=name=>mutationAdapter.retry(name);
 store.dialogMutationUnavailable=name=>{mutationTick();return mutationAdapter.pending(name)?'Saving shared data…':cellAvailability.unavailable(name);};
 store.mutate=(name,args,row)=>{if(mutationBindings.some(binding=>binding.name===name&&binding.valueParam)&&cellAvailability.unavailable(name))return Promise.reject(Error('Shared data editing is unavailable.'));return mutationAdapter.mutate(name,args,row);};
 window.addEventListener('pageshow',event=>{if(event.persisted)cellAvailability.reconnect();});
 window.addEventListener('pagehide',event=>{if(!event.persisted){cellAvailability.dispose();stopMutations();}});`;
}
