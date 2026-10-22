import type { CompiledDatasetBinding } from "./dataset-contracts.ts";
/** Generates only canonical Apollo calls. All returned rows remain in memory. */
export function datasetBootSetup(
  bindings: readonly CompiledDatasetBinding[],
): string {
  if (!bindings.length) return "";
  const documents = Object.fromEntries(
    [...new Set(bindings.map((b) => b.backendNamespace))].map((name) => [
      name,
      `query DatasetRead($binding:String!,$schema:String!,$table:String!,$offset:Int!,$limit:Int!,$expectedVersion:Int,$expectedGeneration:Int){${name}{read(binding:$binding,schema:$schema,table:$table,offset:$offset,limit:$limit,expectedVersion:$expectedVersion,expectedGeneration:$expectedGeneration){version generation schema table columns{name type} rows offset nextOffset totalRows}}}`,
    ]),
  );
  return `const datasetBindings=${JSON.stringify(bindings)};
 const datasetDocuments=Object.fromEntries(Object.entries(${JSON.stringify(documents)}).map(([name,source])=>[name,gql(Object.assign([source],{raw:[source]}))]));
 let datasetBudget={bytes:0,rows:0};let datasetReadFailed=false;
 const readImport=async name=>{const binding=datasetBindings.find(b=>b.name===name);if(!binding)throw Error('Dataset read unavailable');const budget=datasetBudget;
 try{return await readCompiledDataset(binding,async(namespace,variables)=>{const result=await client.query({query:datasetDocuments[namespace],variables});if(result.errors?.length||!result.data?.[namespace]?.read)throw Error('Dataset read unavailable');return result.data[namespace].read;},{},budget);}catch{if(budget===datasetBudget)datasetReadFailed=true;throw Error('Dataset read unavailable');}};`;
}
export const datasetBootStatus = `const status=document.querySelector('[data-migration-dataset-status]');
 const setDatasetStatus=(message)=>{if(status){status.textContent=message;status.hidden=!message;}};
 const refreshDatasets=()=>{datasetBudget={bytes:0,rows:0};datasetReadFailed=false;setTables({});setQueryErrors({});setDatasetStatus('Loading protected data…');engine.invalidate(flow.imports.map(i=>i.ref));void run();};
 const retry=document.createElement('button');retry.type='button';retry.textContent='Refresh data';retry.addEventListener('click',refreshDatasets);status?.after(retry);
 const datasetWatches=[];
 for(const binding of datasetBindings)for(const table of binding.tables){let received=false;
  const subscription=client.watchQuery({query:datasetDocuments[binding.backendNamespace],variables:{binding:binding.name,schema:table.schema,table:table.table,offset:0,limit:1}}).subscribe(result=>{
   if(!result.errors?.length&&!result.data?.[binding.backendNamespace]?.read)return;
   if(!received){received=true;return;}refreshDatasets();
  });datasetWatches.push(subscription);
 }
 window.addEventListener('pagehide',event=>{if(!event.persisted){for(const subscription of datasetWatches)subscription.unsubscribe();}});`;
