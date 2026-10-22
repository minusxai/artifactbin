import { validLocalValue } from "./local-state.ts";
import type { LocalDeclaration } from "./local-contracts.ts";
/** Generated module imports only the already-compiled kit context bridge and Apollo. */
export function localBootSource(
  declarations: LocalDeclaration[],
  sql?: { flow: unknown; wasmBase64: string; tables: unknown },
): string {
  return `import {client,gql} from '@afbin/apollo';
import {hydrateIsland} from '@mx/rt';
import {createSignal} from 'solid-js';
${sql ? "import {pageEngine} from 'migration-sqlite';" : ""}
const declarations=${JSON.stringify(declarations)};
const validLocalValue=(()=>{const __name=f=>f;return ${validLocalValue.toString()};})();
${sql ? `const flow=${JSON.stringify(sql.flow)};const engine=pageEngine(async()=>Uint8Array.from(atob(${JSON.stringify(sql.wasmBase64)}),c=>c.charCodeAt(0)),async()=>{throw Error('Remote imports are unavailable');});` : ""}
const query=gql\`{ compiledPage }\`;
export function boot({TREE}) {
 const [state,setState]=createSignal(Object.fromEntries(declarations.map(d=>[d.name,d.default])));
 const values=()=>Object.fromEntries(declarations.filter(d=>d.type!=="table").map(d=>[d.name,state()[d.name]]));
 const localTables=()=>Object.fromEntries(declarations.filter(d=>d.type==="table").map(d=>[d.name,state()[d.name]]));
 const table=name=>{const d=declarations.find(d=>d.name===name&&d.type==="table");return d?{rows:state()[name],columns:d.columns}:tables()[name];};
 const [tables,setTables]=createSignal(${JSON.stringify({})});
 const [queryErrors,setQueryErrors]=createSignal({});
 const [pending,setPending]=createSignal(false);
 let generation=0;
 ${sql ? `setTables(${JSON.stringify(sql.tables)});const run=async()=>{const current=++generation;setPending(true);try{engine.prepare(flow,[]);const deadline=Date.now()+5000;while(!engine.ready(flow,[])){if(Date.now()>deadline)throw Error("Local engine loading timed out");await new Promise(resolve=>setTimeout(resolve,10));}const answer=await engine.run(flow,flow.queries.map(q=>q.name),{values:values(),localTables:localTables(),userId:null,now:new Date().toISOString(),tz:'UTC'});if(current===generation){setTables(answer.tables);setQueryErrors(answer.errors);}}catch{if(current===generation)setQueryErrors(Object.fromEntries(flow.queries.map(q=>[q.name,'Local query failed'])));}finally{if(current===generation)setPending(false);}};` : "const run=()=>{};"}
 const checked=(next)=>Object.fromEntries(declarations.map(d=>{const v=next?.[d.name];return [d.name,validLocalValue(d,v)?v:d.default];}));
 const write=patch=>{for(const [name,v]of Object.entries(patch)){const d=declarations.find(d=>d.name===name);if(!d||!validLocalValue(d,v))throw Error('Invalid local scalar write');}
 client.updateQuery({query},data=>({...data,compiledPage:{...checked(data.compiledPage),...patch}}));};
 const store={getValue:name=>values()[name],setValue:(name,v)=>write({[name]:v}),setValues:write};
 const unavailable=()=>Promise.reject(Error('Shared data is not supported by this migration'));
 const context={values, value:name=>values()[name],table,tableSnapshot:table,pending:()=>pending(),error:name=>queryErrors()[name],people:()=>({}),setValue:store.setValue,mutate:unavailable,writesUnavailable:()=>null,mutationUnavailable:()=>null,mutating:()=>false,assetsUrl:()=>null,viewer:()=>null,drawings:()=>({}),valueType:name=>declarations.find(d=>d.name===name)?.type,nullable:name=>declarations.find(d=>d.name===name)?.default===null,declaresQueries:()=>${Boolean(sql)},writes:{current:()=>[],subscribe:()=>()=>{},dismiss:()=>{}},store:()=>store,trustedPortal:()=>null,loadChart:unavailable};
 let ready=false;
 client.watchQuery({query}).subscribe(({data})=>{if(!ready){ready=true;hydrateIsland('d-',TREE,context);}setState(checked(data.compiledPage));void run();});
}
`;
}
