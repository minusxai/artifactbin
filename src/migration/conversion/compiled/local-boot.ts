import { dynamicIdentityBoot } from "./dynamic-identity-boot.ts";
import type { LocalDynamicIdentityPlan } from "./reactive-source-contracts.ts";
import { decodeCompiledWasm } from "./wasm.ts";
import type { CompiledWasmPayload } from "./wasm-contracts.ts";
import { completeControlOptions, controlPageRequest } from "./data-controls.ts";
import type { CompiledDataControl } from "./data-control-contracts.ts";
import { datasetMutationBoot } from "./dataset-mutation-boot.ts";
import type { CompiledDatasetMutation } from "./dataset-mutations-contracts.ts";
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
    wasmBase64?: string;
    wasm?: CompiledWasmPayload;
    tables: unknown;
    bindings?: readonly CompiledDatasetBinding[];
  },
  author?: CompiledAuthorPlan,
  unavailableQueries?: readonly string[],
  charts = false,
  mutations: readonly CompiledDatasetMutation[] = [],
  controls: readonly CompiledDataControl[] = [],
  identities?: LocalDynamicIdentityPlan,
): string {
  const imports = sql?.bindings?.length ?? 0;
  return `import {client,gql} from '@afbin/apollo';
import {hydrateIsland} from '@mx/rt';
import {markCompiledReady} from 'migration-readiness';
${identities ? "import {installDynamicIdentities} from 'migration-identities';" : ""}
import {createSignal,createRoot,createEffect,untrack} from 'solid-js';
${author ? "import {mount as mountAuthor} from 'migration-author-entry';import {authorApolloPorts} from 'migration-author-ports';" : ""}
${mutations.length ? "import {createCompiledDatasetMutations,compiledMutationIntentStore} from 'migration-mutations';" : ""}
${charts ? "import {charts} from 'migration-charts';" : ""}
${imports ? "import {readCompiledDataset} from 'migration-datasets';" : ""}
${sql ? "import {pageEngine} from 'migration-sqlite';" : ""}
const decodeCompiledWasm=(()=>{const __name=f=>f;return ${decodeCompiledWasm.toString()};})();
const declarations=${JSON.stringify(declarations)};
const optionQueries=${JSON.stringify([...new Set(controls.flatMap((p) => (p.kind === "select" && typeof p.options === "string" ? [p.options] : [])))])};
const completeControlOptions=(()=>{const __name=f=>f;return ${completeControlOptions.toString()};})();
const controlPageRequest=(()=>{const __name=f=>f;return ${controlPageRequest.toString()};})();
const validLocalValue=(()=>{const __name=f=>f;return ${validLocalValue.toString()};})();
${datasetBootSetup(sql?.bindings ?? [])}
${sql ? `const flow=${JSON.stringify(sql.flow)};const engine=pageEngine(async()=>${sql.wasm ? `decodeCompiledWasm(${JSON.stringify(sql.wasm)})` : `Uint8Array.from(atob(${JSON.stringify(sql.wasmBase64)}),c=>c.charCodeAt(0))`},${imports ? "readImport" : "async()=>{throw Error('Remote imports are unavailable');}"});` : ""}
const query=gql\`{ compiledPage }\`;
export function boot({TREE}) {
 const [state,setState]=createSignal(Object.fromEntries(declarations.map(d=>[d.name,d.default])));
 const values=()=>Object.fromEntries(declarations.filter(d=>d.type!=="table").map(d=>[d.name,state()[d.name]]));
 const localTables=()=>Object.fromEntries(declarations.filter(d=>d.type==="table").map(d=>[d.name,state()[d.name]]));
 const table=name=>{const d=declarations.find(d=>d.name===name&&d.type==="table");return d?{rows:state()[name],columns:d.columns}:tables()[name];};
 const [tables,setTables]=createSignal(${JSON.stringify({})});
 const [queryErrors,setQueryErrors]=createSignal(${JSON.stringify(Object.fromEntries((unavailableQueries ?? []).map((name) => [name, "Historical data is unavailable"])))});
 const [controlError,setControlError]=createSignal('');
 const [pending,setPending]=createSignal(false);
 ${controls.length ? "const controlStatus=document.createElement('p');controlStatus.setAttribute('role','status');controlStatus.dataset.migrationControlStatus='';document.body.append(controlStatus);createRoot(()=>createEffect(()=>{controlStatus.textContent=controlError()||(pending()?'Loading data controls…':'');}));" : ""}
 let generation=0;
 ${sql ? `setTables(Object.fromEntries(Object.entries(${JSON.stringify(sql.tables)}).filter(([name,t])=>!optionQueries.includes(name)||!t.truncated)));const run=async()=>{${identities ? "if(identityFailed)return;" : ""}const current=++generation;setPending(true);setControlError('');try{engine.prepare(flow,${imports ? "flow.imports.map(i=>i.name)" : "[]"});const deadline=Date.now()+${imports ? 15000 : 5000};while(!engine.ready(flow,${imports ? "flow.imports.map(i=>i.name)" : "[]"})){${imports ? "if(datasetReadFailed)throw Error('Dataset read unavailable');" : ""}if(Date.now()>deadline)throw Error("Local engine loading timed out");await new Promise(resolve=>setTimeout(resolve,10));}const answer=await engine.run(flow,flow.queries.map(q=>q.name),{values:values(),localTables:localTables(),userId:null,now:new Date().toISOString(),tz:'UTC'});for(const name of optionQueries){if(flow.queries.some(q=>q.name===name)&&(!answer.tables[name]||answer.errors[name]))throw Error("Select options unavailable");if(answer.tables[name])answer.tables[name]=await completeControlOptions(answer.tables[name],(offset,limit)=>engine.page(flow,name,{offset,limit},{values:values(),localTables:localTables(),userId:null,now:new Date().toISOString(),tz:'UTC'}));}if(current===generation){setTables(answer.tables);setQueryErrors(answer.errors);${imports ? "setDatasetStatus(Object.keys(answer.errors).length?'Protected data queries could not be evaluated.':'');" : ""}}}catch{if(current===generation){setTables({});setControlError('Data controls are unavailable. Refresh data or check the supported row limits.');setQueryErrors(Object.fromEntries(flow.queries.map(q=>[q.name,'Local query failed'])));${imports ? "setDatasetStatus('Protected data is unavailable. Check access and refresh data.');" : ""}}}finally{if(current===generation)setPending(false);}};` : "const run=()=>{};"}
 ${imports ? datasetBootStatus : ""}
 ${identities ? dynamicIdentityBoot(identities) : ""}
 const checked=(next)=>Object.fromEntries(declarations.map(d=>{const v=next?.[d.name];return [d.name,validLocalValue(d,v)?v:d.default];}));
 const write=patch=>{${identities ? "if(identityFailed)throw Error('Page identities unavailable');" : ""}for(const [name,v]of Object.entries(patch)){const d=declarations.find(d=>d.name===name);if(!d||!validLocalValue(d,v))throw Error('Invalid local scalar write');}
 client.updateQuery({query},data=>({...data,compiledPage:{...checked(data.compiledPage),...patch}}));};
 const store={getValue:name=>values()[name],setValue:(name,v)=>write({[name]:v}),setValues:write};
 ${sql ? `store.fetchPage=async(name,page)=>{if(!flow.queries.some(q=>q.name===name))throw Error('Undeclared table query');const current=generation;const request=controlPageRequest(page,table(name)?.columns??[]);const answer=await engine.page(flow,name,request,{values:values(),localTables:localTables(),userId:null,now:new Date().toISOString(),tz:'UTC'});if(current!==generation)throw Error('Table snapshot changed');return answer;};` : ""}
 const unavailable=()=>Promise.reject(Error('Shared data is not supported by this migration'));
 ${mutations.length ? datasetMutationBoot(mutations, Boolean(imports)) : ""}
 const context={values, value:name=>values()[name],table,tableSnapshot:table,pending:()=>pending(),error:name=>queryErrors()[name],people:()=>({}),setValue:store.setValue,mutate:unavailable,writesUnavailable:()=>null,mutationUnavailable:name=>{${unavailableQueries ? "return 'Historical shared data writes are unavailable.';" : mutations.length ? "mutationTick();return mutationAdapter.status(name)?.state==='unknown'?'Reconcile the previous save before saving again.':null;" : "return null;"}},mutating:name=>{${mutations.length ? "mutationTick();return mutationAdapter.pending(name);" : "return false;"}},assetsUrl:()=>null,viewer:()=>null,drawings:()=>({}),valueType:name=>declarations.find(d=>d.name===name)?.type,nullable:name=>declarations.find(d=>d.name===name)?.default===null,declaresQueries:()=>${Boolean(sql)},writes:{current:()=>[],subscribe:()=>()=>{},dismiss:()=>{}},store:()=>store,trustedPortal:()=>null,loadChart:${charts ? "async()=>charts" : "unavailable"}};
 let ready=false;
 ${identities ? "pageSubscription=" : ""}client.watchQuery({query}).subscribe(({data})=>{${identities ? "if(identityFailed)return;" : ""}if(!ready){ready=true;${identities ? "stopIsland=" : ""}hydrateIsland('d-',TREE,context);${identities ? "flushIdentities();if(identityFailed){stopIsland?.();return;}" : ""}}setState(checked(data.compiledPage));${identities ? "flushIdentities();if(identityFailed)return;" : ""}markCompiledReady();void run();});
 ${identities ? "if(identityFailed)pageSubscription.unsubscribe();if(store.mutate){const mutate=store.mutate;store.mutate=(...args)=>identityFailed?Promise.reject(Error('Page identities unavailable')):mutate(...args);}" : ""}
 ${author ? authorDocumentBoot(author) : ""}
 ${identities && author ? "stopAuthored=stopAuthor;if(identityFailed)stopAuthored();" : ""}
}
`;
}
