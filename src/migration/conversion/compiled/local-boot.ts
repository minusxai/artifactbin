import {cellUserChoiceBoot} from "./cell-user-choice-boot.ts";
import {localMutationBootSource} from "./local-mutation-boot.ts";
import {fileUploadBootSource} from "./file-upload-boot.ts";
import type {CompiledFileUploadSite} from "./file-upload-runtime-contracts.ts";
import{viewerBootSource}from"./viewer-boot.ts";
import type{CompiledViewerBinding}from"./viewer-contracts.ts";
import { personBootSource } from "./person-boot.ts";
import type { CompiledPersonBinding } from "./person-contracts.ts";
import { membersBootSource } from "./members-boot.ts";
import type { CompiledMembersBinding } from "./members-contracts.ts";
import { dynamicIdentityBoot } from "./dynamic-identity-boot.ts";
import type { LocalDynamicIdentityPlan } from "./reactive-source-contracts.ts";
import { decodeCompiledWasm } from "./wasm.ts";
import type { CompiledWasmPayload } from "./wasm-contracts.ts";
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
    sourceQueries?:readonly import("./source-query-contracts.ts").CompiledSourceQueryBinding[];
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
  attachmentSites: readonly CompiledFileUploadSite[] = [],
  localMutationNames: readonly string[] = [],
  cellUserChoiceBindings:readonly import("./cell-user-choice-contracts.ts").CompiledCellUserChoiceBinding[]=[],
  historicalUnavailableMutations: readonly string[] = [],
): string {
  const imports = sql?.bindings?.length ?? 0;
  const members=Boolean(sql?.membersBinding);
  return `import {client,gql} from '@afbin/apollo';
${localMutationNames.length ? "import {createCompiledLocalMutations,applyCompiledLocalMutation} from 'migration-local-mutations';import {applyLegacyScalarOperation} from 'migration-scalar-mutations';import {mutationRequestFor} from '@/lib/dataflow/mutation-request-builder';" : ""}
${attachmentSites.length ? "import {createCompiledFileUploads} from 'migration-file-uploads';" : ""}
import {hydrateIsland} from '@mx/rt';
import {markCompiledReady} from 'migration-readiness';
${deck ? "import {startDeck} from 'migration-deck';" : ""}
${identities ? "import {installDynamicIdentities} from 'migration-identities';" : ""}
import {createSignal,createRoot,createEffect,untrack} from 'solid-js';
${author ? "import {mount as mountAuthor} from 'migration-author-entry';import {authorApolloPorts} from 'migration-author-ports';" : ""}
${mutations.length ? "import {createCompiledMutationAvailability} from 'migration-mutation-availability';import {createCompiledDatasetMutations,compiledMutationIntentStore} from 'migration-mutations';" : ""}
${charts ? "import {charts} from 'migration-charts';" : ""}
${cellUserChoiceBindings.length ? "import {createCompiledCellUserChoices} from 'migration-cell-user-choices';" : ""}
${personBindings.length ? "import {createCompiledPeople} from 'migration-people';" : ""}
${viewerBinding ? "import {createCompiledViewer} from 'migration-viewer';" : ""}
${members ? "import {createCompiledMembers} from 'migration-members';" : ""}
${imports ? "import {readCompiledDataset} from 'migration-datasets';" : ""}
${sql?.sourceQueries?.length?"import {createCompiledSourceQueryEngine} from 'migration-source-queries';":""}
${sql ? "import {pageEngine} from 'migration-sqlite';import {createCompiledQueryController,compiledQueryClock} from 'migration-query-controller';" : ""}
const decodeCompiledWasm=(()=>{const __name=f=>f;return ${decodeCompiledWasm.toString()};})();
const declarations=${JSON.stringify(declarations)};
const optionQueries=${JSON.stringify([...new Set([...cellOptionQueries,...controls.flatMap((p) => (p.kind === "select" && typeof p.options === "string" ? [p.options] : []))])])};
const validLocalValue=(()=>{const __name=f=>f;return ${validLocalValue.toString()};})();
${datasetBootSetup(sql?.bindings ?? [])}
${sql?.sourceQueries?.length ? `const flow=${JSON.stringify(sql.flow)};const sourceQueryDocument=gql\`query SourceQuery($name:String!,$valuesJson:String!,$offset:Int!,$limit:Int!,$sortJson:String){legacyData{sourceQuery(name:$name,valuesJson:$valuesJson,offset:$offset,limit:$limit,sortJson:$sortJson)}}\`;const engine=createCompiledSourceQueryEngine(${JSON.stringify(sql.sourceQueries)},{read:async(binding,variables)=>{const result=await client.query({query:sourceQueryDocument,variables});if(result.errors?.length)throw Error('Source query unavailable');return result.data?.legacyData?.sourceQuery;}});` : sql ? `const flow=${JSON.stringify(sql.flow)};const engine=pageEngine(async()=>${sql.wasm ? `decodeCompiledWasm(${JSON.stringify(sql.wasm)})` : `Uint8Array.from(atob(${JSON.stringify(sql.wasmBase64)}),c=>c.charCodeAt(0))`},${imports ? "readImport" : "async()=>{throw Error('Remote imports are unavailable');}"});` : ""}
const query=gql\`{ compiledPage }\`;
export function boot({TREE}) {
 ${viewerBinding ? "const [viewer,setViewer]=createSignal(null);let viewerAvailable=false;" : ""}
 const [state,setState]=createSignal(Object.fromEntries(declarations.map(d=>[d.name,d.default])));
 const values=()=>Object.fromEntries(declarations.filter(d=>d.type!=="table").map(d=>[d.name,state()[d.name]]));
 const localTables=()=>Object.fromEntries(declarations.filter(d=>d.type==="table").map(d=>[d.name,state()[d.name]]));
 const table=name=>{const d=declarations.find(d=>d.name===name&&d.type==="table");return d?{rows:state()[name],columns:d.columns}:tables()[name];};
 ${sql?.sourceQueries?.length?"const sourceAccessReady=new Set();":""}
 const [tables,setTables]=createSignal(${JSON.stringify({})});
 const [queryErrors,setQueryErrors]=createSignal(${JSON.stringify(Object.fromEntries((unavailableQueries ?? []).map((name) => [name, "Historical data is unavailable"])))});
 const [controlError,setControlError]=createSignal('');
 const [pending,setPending]=createSignal(false);
 ${controls.length || members || sql?.sourceQueries?.length ? "const controlStatus=document.createElement('p');controlStatus.setAttribute('role','status');controlStatus.dataset.migrationControlStatus='';document.body.append(controlStatus);createRoot(()=>createEffect(()=>{controlStatus.textContent=controlError()||(pending()?'Loading data controls…':'');}));" : ""}
 let queryController;
 const stopControlRuns=()=>queryController?.dispose();
 window.addEventListener('pagehide',event=>{if(!event.persisted)stopControlRuns();});
 ${sql ? `setTables(Object.fromEntries(Object.entries(${JSON.stringify(sql.tables)}).filter(([name,t])=>!optionQueries.includes(name)||!t.truncated)));
 queryController=createCompiledQueryController({queries:flow.queries.map(q=>q.name),optionQueries,deadlineMs:${imports||sql.sourceQueries?.length ? 15000 : 5000}},{
 engine:{prepare:()=>engine.prepare(flow,${imports ? "flow.imports.map(i=>i.name)" : "[]"}),ready:()=>engine.ready(flow,${imports ? "flow.imports.map(i=>i.name)" : "[]"}),run:evaluation=>engine.run(flow,flow.queries.map(q=>q.name),evaluation),page:(name,page,evaluation)=>engine.page(flow,name,page,evaluation)},
 evaluation:async()=>{${members ? "const memberRows=(await membersAdapter.read()).rows;" : ""}return {values:values(),localTables:localTables(),userId:${viewerBinding ? "viewer()?.id??null" : "null"},now:new Date().toISOString(),tz:'UTC'${members ? ",members:memberRows" : ""}};},
 availability:()=>${sql.sourceQueries?.length?`sourceAccessReady.size!==${sql.sourceQueries.length}?'blocked':`:""}${viewerBinding ? "!viewerAvailable?'blocked':" : ""}${identities ? "identityFailed?'blocked':" : ""}${imports ? "datasetReadFailed?'failed':" : ""}'ready',
 clock:compiledQueryClock,
 publish:event=>{if(event.state==='pending'){setPending(true);setControlError('');return;}setPending(false);if(event.state==='settled'){setTables(event.answer.tables);setQueryErrors(event.answer.errors);${imports ? "setDatasetStatus(Object.keys(event.answer.errors).length?'Protected data queries could not be evaluated.':'');" : ""}}else{setTables({});setQueryErrors(event.state==='failed'?event.errors:{});if(event.state==='failed'){setControlError('Data controls are unavailable. Refresh data or check the supported row limits.');${imports ? "setDatasetStatus('Protected data is unavailable. Check access and refresh data.');" : ""}}}}
 });const run=()=>queryController.refresh();` : viewerBinding ? "const run=async()=>viewerAvailable;" : "const run=()=>{};"}
 ${members ? membersBootSource(sql!.membersBinding!) : ""}
 ${imports ? datasetBootStatus : ""}
 ${identities ? dynamicIdentityBoot(identities) : ""}
 const checked=(next)=>Object.fromEntries(declarations.map(d=>{const v=next?.[d.name];return [d.name,validLocalValue(d,v)?v:d.default];}));
 const write=patch=>{${identities ? "if(identityFailed)throw Error('Page identities unavailable');" : ""}for(const [name,v]of Object.entries(patch)){const d=declarations.find(d=>d.name===name);if(!d||!validLocalValue(d,v))throw Error('Invalid local scalar write');}
 client.updateQuery({query},data=>({...data,compiledPage:{...checked(data.compiledPage),...patch}}));};
 const store={getValue:name=>values()[name],setValue:(name,v)=>write({[name]:v}),setValues:write};
 ${sql ? `store.fetchPage=(name,page)=>queryController.fetchPage(name,page,table(name)?.columns??[]);` : ""}
 const unavailable=()=>Promise.reject(Error('Shared data is not supported by this migration'));
 ${mutations.length ? datasetMutationBoot(mutations, Boolean(imports)) : ""}
 ${localMutationNames.length ? localMutationBootSource(localMutationNames) : ""}
 ${fileUploadBootSource(attachmentSites)}
 ${personBindings.length ? personBootSource(personBindings) : ""}
 ${cellUserChoiceBindings.length ? cellUserChoiceBoot(cellUserChoiceBindings):""}
 const context={cellUserOptions:${cellUserChoiceBindings.length?"cellUserOptions":"()=>({})"},values, value:name=>values()[name],table,tableSnapshot:table,pending:()=>pending(),error:name=>queryErrors()[name],people:${personBindings.length ? "people" : "()=>({})"},setValue:store.setValue,mutate:${localMutationNames.length ? "store.mutate" : "unavailable"},writesUnavailable:()=>null,mutationUnavailable:name=>{${unavailableQueries ? "return 'Historical shared data writes are unavailable.';" : mutations.length ? "mutationTick();return mutationAdapter.status(name)?.state==='unknown'?'Reconcile the previous save before saving again.':mutationBindings.some(binding=>binding.name===name&&binding.valueParam)?cellAvailability.unavailable(name):null;" : "return null;"}},mutating:name=>{${localMutationNames.length ? "return localMutationPending();" : mutations.length ? "mutationTick();return mutationAdapter.pending(name);" : "return false;"}},assetsUrl:()=>null,viewer:${viewerBinding ? "viewer" : "()=>null"},drawings:()=>({}),valueType:name=>declarations.find(d=>d.name===name)?.type,nullable:name=>declarations.find(d=>d.name===name)?.default===null,declaresQueries:()=>${Boolean(sql)},writes:{current:()=>[],subscribe:()=>()=>{},dismiss:()=>{}},store:()=>store,trustedPortal:()=>null,loadChart:${charts ? "async()=>charts" : "unavailable"}};
 let ready=false;
 ${deck ? "let stopDeck=()=>{};window.addEventListener('pagehide',()=>stopDeck(),{once:true});" : ""}
 ${identities ? "pageSubscription=" : ""}client.watchQuery({query}).subscribe(({data})=>{${identities ? "if(identityFailed)return;" : ""}if(!ready){ready=true;${identities ? "stopIsland=" : ""}hydrateIsland('d-',TREE,context);${deck ? `stopDeck=startDeck(${JSON.stringify(deck)});` : ''}${identities ? "flushIdentities();if(identityFailed){stopIsland?.();return;}" : ""}}setState(checked(data.compiledPage));${personBindings.length ? "peopleAdapter.update(values());" : ""}${identities ? "flushIdentities();if(identityFailed)return;" : ""}markCompiledReady();void run();});
 ${identities ? "if(identityFailed)pageSubscription.unsubscribe();if(store.mutate){const mutate=store.mutate;store.mutate=(...args)=>identityFailed?Promise.reject(Error('Page identities unavailable')):mutate(...args);}" : ""}
 ${author ? authorDocumentBoot(author,localMutationNames,historicalUnavailableMutations) : ""}
 ${viewerBinding ? viewerBootSource(viewerBinding) : ""}
 ${sql?.sourceQueries?.length?`const sourceAccessDocument=gql\`query SourceQueryAvailability($name:String!){legacyData{sourceQueryAvailability(name:$name)}}\`;
 const sourceAccessWatches=${JSON.stringify(sql.sourceQueries.map(b=>b.name))}.map(name=>client.watchQuery({query:sourceAccessDocument,variables:{name},clearOnRefresh:true}).subscribe(result=>{queryController.invalidate();setTables({});setQueryErrors({});if(!result.errors?.length&&result.data?.legacyData?.sourceQueryAvailability===true){sourceAccessReady.add(name);setControlError('');if(sourceAccessReady.size===${sql.sourceQueries.length})queueMicrotask(()=>void run());}else{sourceAccessReady.delete(name);setControlError(result.errors?.length||result.data?.legacyData?.sourceQueryAvailability===false?'Source queries are unavailable. Check access.':'Loading source query access…');}}));
 window.addEventListener('pagehide',event=>{if(!event.persisted){for(const subscription of sourceAccessWatches)subscription.unsubscribe();sourceAccessReady.clear();}});`:""}
 ${identities && author ? "stopAuthored=stopAuthor;if(identityFailed)stopAuthored();" : ""}
}
`;
}
