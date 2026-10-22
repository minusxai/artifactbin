import { authorDocumentBoot } from "./author-document-boot.ts";
import type { CompiledAuthorPlan } from "./author-document-contracts.ts";
import { datasetBootSetup, datasetBootStatus } from "./dataset-boot.ts";
import type { CompiledDatasetBinding } from "./dataset-contracts.ts";
import { validLocalValue } from "./local-state.ts";
import type { LocalDeclaration } from "./local-contracts.ts";
/** Generated module imports only the already-compiled kit context bridge and Apollo. */
export function localBootSource(
  declarations: LocalDeclaration[],
  sql?: {
    flow: unknown;
    wasmBase64: string;
    tables: unknown;
    bindings?: readonly CompiledDatasetBinding[];
  },
  author?: CompiledAuthorPlan,
  unavailableQueries?: readonly string[],
  charts = false,
): string {
  const imports = sql?.bindings?.length ?? 0;
  return `import {client,gql} from '@afbin/apollo';
import {hydrateIsland} from '@mx/rt';
import {createSignal,createRoot,createEffect,untrack} from 'solid-js';
${author ? "import {mount as mountAuthor} from 'migration-author-entry';import {authorApolloPorts} from 'migration-author-ports';" : ""}
${charts ? "import {charts} from 'migration-charts';" : ""}
${imports ? "import {readCompiledDataset} from 'migration-datasets';" : ""}
${sql ? "import {pageEngine} from 'migration-sqlite';" : ""}
const declarations=${JSON.stringify(declarations)};
const validLocalValue=(()=>{const __name=f=>f;return ${validLocalValue.toString()};})();
${datasetBootSetup(sql?.bindings ?? [])}
${sql ? `const flow=${JSON.stringify(sql.flow)};const engine=pageEngine(async()=>Uint8Array.from(atob(${JSON.stringify(sql.wasmBase64)}),c=>c.charCodeAt(0)),${imports ? "readImport" : "async()=>{throw Error('Remote imports are unavailable');}"});` : ""}
const query=gql\`{ compiledPage }\`;
export function boot({TREE}) {
 const [state,setState]=createSignal(Object.fromEntries(declarations.map(d=>[d.name,d.default])));
 const values=()=>Object.fromEntries(declarations.filter(d=>d.type!=="table").map(d=>[d.name,state()[d.name]]));
 const localTables=()=>Object.fromEntries(declarations.filter(d=>d.type==="table").map(d=>[d.name,state()[d.name]]));
 const table=name=>{const d=declarations.find(d=>d.name===name&&d.type==="table");return d?{rows:state()[name],columns:d.columns}:tables()[name];};
 const [tables,setTables]=createSignal(${JSON.stringify({})});
 const [queryErrors,setQueryErrors]=createSignal(${JSON.stringify(Object.fromEntries((unavailableQueries ?? []).map((name) => [name, "Historical data is unavailable"])))});
 const [pending,setPending]=createSignal(false);
 let generation=0;
 ${sql ? `setTables(${JSON.stringify(sql.tables)});const run=async()=>{const current=++generation;setPending(true);try{engine.prepare(flow,${imports ? "flow.imports.map(i=>i.name)" : "[]"});const deadline=Date.now()+${imports ? 15000 : 5000};while(!engine.ready(flow,${imports ? "flow.imports.map(i=>i.name)" : "[]"})){${imports ? "if(datasetReadFailed)throw Error('Dataset read unavailable');" : ""}if(Date.now()>deadline)throw Error("Local engine loading timed out");await new Promise(resolve=>setTimeout(resolve,10));}const answer=await engine.run(flow,flow.queries.map(q=>q.name),{values:values(),localTables:localTables(),userId:null,now:new Date().toISOString(),tz:'UTC'});if(current===generation){setTables(answer.tables);setQueryErrors(answer.errors);${imports ? "setDatasetStatus(Object.keys(answer.errors).length?'Protected data queries could not be evaluated.':'');" : ""}}}catch{if(current===generation){setTables({});setQueryErrors(Object.fromEntries(flow.queries.map(q=>[q.name,'Local query failed'])));${imports ? "setDatasetStatus('Protected data is unavailable. Check access and refresh data.');" : ""}}}finally{if(current===generation)setPending(false);}};` : "const run=()=>{};"}
 ${imports ? datasetBootStatus : ""}
 const checked=(next)=>Object.fromEntries(declarations.map(d=>{const v=next?.[d.name];return [d.name,validLocalValue(d,v)?v:d.default];}));
 const write=patch=>{for(const [name,v]of Object.entries(patch)){const d=declarations.find(d=>d.name===name);if(!d||!validLocalValue(d,v))throw Error('Invalid local scalar write');}
 client.updateQuery({query},data=>({...data,compiledPage:{...checked(data.compiledPage),...patch}}));};
 const store={getValue:name=>values()[name],setValue:(name,v)=>write({[name]:v}),setValues:write};
 const unavailable=()=>Promise.reject(Error('Shared data is not supported by this migration'));
 const context={values, value:name=>values()[name],table,tableSnapshot:table,pending:()=>pending(),error:name=>queryErrors()[name],people:()=>({}),setValue:store.setValue,mutate:unavailable,writesUnavailable:()=>null,mutationUnavailable:()=>null,mutating:()=>false,assetsUrl:()=>null,viewer:()=>null,drawings:()=>({}),valueType:name=>declarations.find(d=>d.name===name)?.type,nullable:name=>declarations.find(d=>d.name===name)?.default===null,declaresQueries:()=>${Boolean(sql)},writes:{current:()=>[],subscribe:()=>()=>{},dismiss:()=>{}},store:()=>store,trustedPortal:()=>null,loadChart:${charts ? "async()=>charts" : "unavailable"}};
 let ready=false;
 client.watchQuery({query}).subscribe(({data})=>{if(!ready){ready=true;hydrateIsland('d-',TREE,context);}setState(checked(data.compiledPage));void run();});
 ${author ? authorDocumentBoot(author) : ""}
}
`;
}
