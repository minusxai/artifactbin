import{viewerBootSource}from"./viewer-boot.ts";
import type{CompiledViewerBinding}from"./viewer-contracts.ts";
import {createControlOptionsLifecycle} from "./control-options-lifecycle.ts";
import { personBootSource } from "./person-boot.ts";
import type { CompiledPersonBinding } from "./person-contracts.ts";
import { membersBootSource } from "./members-boot.ts";
import type { CompiledMembersBinding } from "./members-contracts.ts";
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
    membersBinding?:CompiledMembersBinding;
  },
  author?: CompiledAuthorPlan,
  unavailableQueries?: readonly string[],
  charts = false,
  mutations: readonly CompiledDatasetMutation[] = [],
  controls: readonly CompiledDataControl[] = [],
  identities?: LocalDynamicIdentityPlan,
  deck?: import("./slide-deck-contracts.ts").CompiledSlideDeck,
  personBindings: readonly CompiledPersonBinding[] = [],
  viewerBinding?:CompiledViewerBinding,
  cellOptionQueries: readonly string[] = [],
): string {
  const imports = sql?.bindings?.length ?? 0;
  const members=Boolean(sql?.membersBinding);
  return `import {client,gql} from '@afbin/apollo';
import {hydrateIsland} from '@mx/rt';
import {markCompiledReady} from 'migration-readiness';
${deck ? "import {startDeck} from 'migration-deck';" : ""}
${identities ? "import {installDynamicIdentities} from 'migration-identities';" : ""}
import {createSignal,createRoot,createEffect,untrack} from 'solid-js';
${author ? "import {mount as mountAuthor} from 'migration-author-entry';import {authorApolloPorts} from 'migration-author-ports';" : ""}
${mutations.length ? "import {createCompiledMutationAvailability} from 'migration-mutation-availability';import {createCompiledDatasetMutations,compiledMutationIntentStore} from 'migration-mutations';" : ""}
${charts ? "import {charts} from 'migration-charts';" : ""}
${personBindings.length ? "import {createCompiledPeople} from 'migration-people';" : ""}
${viewerBinding ? "import {createCompiledViewer} from 'migration-viewer';" : ""}
${members ? "import {createCompiledMembers} from 'migration-members';" : ""}
${imports ? "import {readCompiledDataset} from 'migration-datasets';" : ""}
${sql ? "import {pageEngine} from 'migration-sqlite';" : ""}
const decodeCompiledWasm=(()=>{const __name=f=>f;return ${decodeCompiledWasm.toString()};})();
const declarations=${JSON.stringify(declarations)};
const optionQueries=${JSON.stringify([...new Set([...cellOptionQueries,...controls.flatMap((p) => (p.kind === "select" && typeof p.options === "string" ? [p.options] : []))])])};
const completeControlOptions=(()=>{const __name=f=>f;return ${completeControlOptions.toString()};})();
const createControlOptionsLifecycle=(()=>{const __name=f=>f;return ${createControlOptionsLifecycle.toString()};})();
const controlPageRequest=(()=>{const __name=f=>f;return ${controlPageRequest.toString()};})();
const validLocalValue=(()=>{const __name=f=>f;return ${validLocalValue.toString()};})();
${datasetBootSetup(sql?.bindings ?? [])}
${sql ? `const flow=${JSON.stringify(sql.flow)};const engine=pageEngine(async()=>${sql.wasm ? `decodeCompiledWasm(${JSON.stringify(sql.wasm)})` : `Uint8Array.from(atob(${JSON.stringify(sql.wasmBase64)}),c=>c.charCodeAt(0))`},${imports ? "readImport" : "async()=>{throw Error('Remote imports are unavailable');}"});` : ""}
const query=gql\`{ compiledPage }\`;
export function boot({TREE}) {
 ${viewerBinding ? "const [viewer,setViewer]=createSignal(null);let viewerAvailable=false;" : ""}
 const [state,setState]=createSignal(Object.fromEntries(declarations.map(d=>[d.name,d.default])));
 const values=()=>Object.fromEntries(declarations.filter(d=>d.type!=="table").map(d=>[d.name,state()[d.name]]));
 const localTables=()=>Object.fromEntries(declarations.filter(d=>d.type==="table").map(d=>[d.name,state()[d.name]]));
 const table=name=>{const d=declarations.find(d=>d.name===name&&d.type==="table");return d?{rows:state()[name],columns:d.columns}:tables()[name];};
 const [tables,setTables]=createSignal(${JSON.stringify({})});
 const [queryErrors,setQueryErrors]=createSignal(${JSON.stringify(Object.fromEntries((unavailableQueries ?? []).map((name) => [name, "Historical data is unavailable"])))});
 const [controlError,setControlError]=createSignal('');
 const [pending,setPending]=createSignal(false);
 ${controls.length || members ? "const controlStatus=document.createElement('p');controlStatus.setAttribute('role','status');controlStatus.dataset.migrationControlStatus='';document.body.append(controlStatus);createRoot(()=>createEffect(()=>{controlStatus.textContent=controlError()||(pending()?'Loading data controls…':'');}));" : ""}
 let generation=0;
 const controlRuns=createControlOptionsLifecycle();
 const stopControlRuns=()=>{generation++;controlRuns.dispose();};
 window.addEventListener('pagehide',event=>{if(!event.persisted)stopControlRuns();});
 ${sql ? `setTables(Object.fromEntries(Object.entries(${JSON.stringify(sql.tables)}).filter(([name,t])=>!optionQueries.includes(name)||!t.truncated)));const run=async()=>{${viewerBinding ? "if(!viewerAvailable)return false;" : ""}${identities ? "if(identityFailed)return;" : ""}const attempt=controlRuns.begin();if(!attempt)return;const current=++generation;setPending(true);setControlError('');try{${members ? "const memberRows=(await membersAdapter.read()).rows;" : ""}engine.prepare(flow,${imports ? "flow.imports.map(i=>i.name)" : "[]"});const deadline=Date.now()+${imports ? 15000 : 5000};while(!engine.ready(flow,${imports ? "flow.imports.map(i=>i.name)" : "[]"})){${imports ? "if(datasetReadFailed)throw Error('Dataset read unavailable');" : ""}if(attempt.signal.aborted)throw Error("Data controls cancelled");if(Date.now()>deadline)throw Error("Local engine loading timed out");await new Promise(resolve=>setTimeout(resolve,10));}const answer=await engine.run(flow,flow.queries.map(q=>q.name),{values:values(),localTables:localTables(),userId:${viewerBinding ? "viewer()?.id??null" : "null"},now:new Date().toISOString(),tz:'UTC'${members ? ",members:memberRows" : ""}});if(attempt.signal.aborted)throw Error("Data controls cancelled");for(const name of optionQueries){if(flow.queries.some(q=>q.name===name)&&(!answer.tables[name]||answer.errors[name]))throw Error("Select options unavailable");if(answer.tables[name])answer.tables[name]=await completeControlOptions(answer.tables[name],(offset,limit)=>engine.page(flow,name,{offset,limit},{values:values(),localTables:localTables(),userId:${viewerBinding ? "viewer()?.id??null" : "null"},now:new Date().toISOString(),tz:'UTC'${members ? ",members:memberRows" : ""}}),{},{signal:attempt.signal});}if(current===generation){setTables(answer.tables);setQueryErrors(answer.errors);${imports ? "setDatasetStatus(Object.keys(answer.errors).length?'Protected data queries could not be evaluated.':'');" : ""}return !Object.keys(answer.errors).length;}}catch{if(current===generation){setTables({});setControlError('Data controls are unavailable. Refresh data or check the supported row limits.');setQueryErrors(Object.fromEntries(flow.queries.map(q=>[q.name,'Local query failed'])));${imports ? "setDatasetStatus('Protected data is unavailable. Check access and refresh data.');" : ""}}}finally{attempt.finish();if(current===generation)setPending(false);}};` : viewerBinding ? "const run=async()=>viewerAvailable;" : "const run=()=>{};"}
 ${members ? membersBootSource(sql!.membersBinding!) : ""}
 ${imports ? datasetBootStatus : ""}
 ${identities ? dynamicIdentityBoot(identities) : ""}
 const checked=(next)=>Object.fromEntries(declarations.map(d=>{const v=next?.[d.name];return [d.name,validLocalValue(d,v)?v:d.default];}));
 const write=patch=>{${identities ? "if(identityFailed)throw Error('Page identities unavailable');" : ""}for(const [name,v]of Object.entries(patch)){const d=declarations.find(d=>d.name===name);if(!d||!validLocalValue(d,v))throw Error('Invalid local scalar write');}
 client.updateQuery({query},data=>({...data,compiledPage:{...checked(data.compiledPage),...patch}}));};
 const store={getValue:name=>values()[name],setValue:(name,v)=>write({[name]:v}),setValues:write};
 ${sql ? `store.fetchPage=async(name,page)=>{${viewerBinding ? "if(!viewerAvailable)throw Error('Reader identity unavailable');" : ""}if(!flow.queries.some(q=>q.name===name))throw Error('Undeclared table query');const current=generation;${members ? "const memberRows=(await membersAdapter.read()).rows;" : ""}const request=controlPageRequest(page,table(name)?.columns??[]);const answer=await engine.page(flow,name,request,{values:values(),localTables:localTables(),userId:${viewerBinding ? "viewer()?.id??null" : "null"},now:new Date().toISOString(),tz:'UTC'${members ? ",members:memberRows" : ""}});if(current!==generation)throw Error('Table snapshot changed');return answer;};` : ""}
 const unavailable=()=>Promise.reject(Error('Shared data is not supported by this migration'));
 ${mutations.length ? datasetMutationBoot(mutations, Boolean(imports)) : ""}
 ${personBindings.length ? personBootSource(personBindings) : ""}
 const context={values, value:name=>values()[name],table,tableSnapshot:table,pending:()=>pending(),error:name=>queryErrors()[name],people:${personBindings.length ? "people" : "()=>({})"},setValue:store.setValue,mutate:unavailable,writesUnavailable:()=>null,mutationUnavailable:name=>{${unavailableQueries ? "return 'Historical shared data writes are unavailable.';" : mutations.length ? "mutationTick();return mutationAdapter.status(name)?.state==='unknown'?'Reconcile the previous save before saving again.':mutationBindings.some(binding=>binding.name===name&&binding.valueParam)?cellAvailability.unavailable(name):null;" : "return null;"}},mutating:name=>{${mutations.length ? "mutationTick();return mutationAdapter.pending(name);" : "return false;"}},assetsUrl:()=>null,viewer:${viewerBinding ? "viewer" : "()=>null"},drawings:()=>({}),valueType:name=>declarations.find(d=>d.name===name)?.type,nullable:name=>declarations.find(d=>d.name===name)?.default===null,declaresQueries:()=>${Boolean(sql)},writes:{current:()=>[],subscribe:()=>()=>{},dismiss:()=>{}},store:()=>store,trustedPortal:()=>null,loadChart:${charts ? "async()=>charts" : "unavailable"}};
 let ready=false;
 ${deck ? "let stopDeck=()=>{};window.addEventListener('pagehide',()=>stopDeck(),{once:true});" : ""}
 ${identities ? "pageSubscription=" : ""}client.watchQuery({query}).subscribe(({data})=>{${identities ? "if(identityFailed)return;" : ""}if(!ready){ready=true;${identities ? "stopIsland=" : ""}hydrateIsland('d-',TREE,context);${deck ? `stopDeck=startDeck(${JSON.stringify(deck)});` : ''}${identities ? "flushIdentities();if(identityFailed){stopIsland?.();return;}" : ""}}setState(checked(data.compiledPage));${personBindings.length ? "peopleAdapter.update(values());" : ""}${identities ? "flushIdentities();if(identityFailed)return;" : ""}markCompiledReady();void run();});
 ${identities ? "if(identityFailed)pageSubscription.unsubscribe();if(store.mutate){const mutate=store.mutate;store.mutate=(...args)=>identityFailed?Promise.reject(Error('Page identities unavailable')):mutate(...args);}" : ""}
 ${author ? authorDocumentBoot(author) : ""}
 ${viewerBinding ? viewerBootSource(viewerBinding) : ""}
 ${identities && author ? "stopAuthored=stopAuthor;if(identityFailed)stopAuthored();" : ""}
}
`;
}
