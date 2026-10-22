import type { LocalScalarDeclaration } from "./local-contracts.ts";
/** Generated module imports only the already-compiled kit context bridge and Apollo. */
export function localBootSource(
  declarations: LocalScalarDeclaration[],
): string {
  return `import {client,gql} from '@afbin/apollo';
import {hydrateIsland} from '@mx/rt';
import {createSignal} from 'solid-js';
const declarations=${JSON.stringify(declarations)};
const query=gql\`{ compiledPage }\`;
export function boot({TREE}) {
 const [values,setValues]=createSignal(Object.fromEntries(declarations.map(d=>[d.name,d.default])));
 const checked=(next)=>Object.fromEntries(declarations.map(d=>{const v=next?.[d.name];return [d.name,v===null||typeof v===d.type?v:d.default];}));
 const write=patch=>{for(const [name,v]of Object.entries(patch)){const d=declarations.find(d=>d.name===name);if(!d||(v!==null&&typeof v!==d.type))throw Error('Invalid local scalar write');}
 client.updateQuery({query},data=>({...data,compiledPage:{...checked(data.compiledPage),...patch}}));};
 const store={getValue:name=>values()[name],setValue:(name,v)=>write({[name]:v}),setValues:write};
 const unavailable=()=>Promise.reject(Error('Shared data is not supported by this migration'));
 const context={values, value:name=>values()[name],table:()=>undefined,tableSnapshot:()=>undefined,pending:()=>false,error:()=>undefined,people:()=>({}),setValue:store.setValue,mutate:unavailable,writesUnavailable:()=>null,mutationUnavailable:()=>null,mutating:()=>false,assetsUrl:()=>null,viewer:()=>null,drawings:()=>({}),valueType:name=>declarations.find(d=>d.name===name)?.type,nullable:name=>declarations.find(d=>d.name===name)?.default===null,declaresQueries:()=>false,writes:{current:()=>[],subscribe:()=>()=>{},dismiss:()=>{}},store:()=>store,trustedPortal:()=>null,loadChart:unavailable};
 let ready=false;
 client.watchQuery({query}).subscribe(({data})=>{if(!ready){ready=true;hydrateIsland('d-',TREE,context);}setValues(checked(data.compiledPage));});
}
`;
}
