import type { CompiledAuthorPlan } from "./author-document-contracts.ts";
export function authorDocumentBoot(plan: CompiledAuthorPlan): string {
  return `const authorExpected=${JSON.stringify(plan.mounts)};
 const authorQuery=gql\`{compiledPage authorSignals}\`;
 const authorPorts=authorApolloPorts(client,authorQuery,name=>({read:()=>({rows:context.table(name)?.rows??[],loading:context.pending(),error:context.error(name)??null}),subscribe:listener=>createRoot(dispose=>{createEffect(()=>{context.table(name);context.pending();context.error(name);untrack(listener);});return dispose;})}),typeof mutationAdapter!=='undefined'?{names:mutationBindings.map(binding=>binding.name),adapter:{mutate:(name,args,row)=>store.mutate(name,args,row)},authorizationContext:()=>client.authorizationContext()}:undefined);
 const authorStatus=document.querySelector('[data-migration-author-status]');
 const authorAbort=new AbortController();
 let authorDisposed=false,authorStop;
 const fallback=[];
 const startAuthor=async()=>{try{if(authorDisposed)return;
 const nodes=[...document.querySelectorAll('[data-migration-author-component]')];
 if(nodes.length!==authorExpected.length)throw Error('Author mount mismatch');
 const mounts=authorExpected.map(expected=>{const element=nodes.find(el=>el.id===expected.identity&&el.getAttribute('data-migration-author-component')===expected.component);if(!element)throw Error('Author mount mismatch');
 const props=JSON.parse(element.getAttribute('data-migration-author-props')||'{}');const bindings=JSON.parse(element.getAttribute('data-migration-author-bind')||'{}');
 for(const [prop,name]of Object.entries(bindings))Object.defineProperty(props,prop,{enumerable:true,get:()=>context.valueType(name)&&context.valueType(name)!=='table'?context.value(name):context.table(name)?.rows});
 fallback.push([element,[...element.childNodes]]);element.replaceChildren();return {element,identity:expected.identity,component:expected.component,props};});
 authorStop=await mountAuthor(authorPorts,mounts,{signal:authorAbort.signal});if(authorDisposed){authorStop();return;}if(authorStatus)authorStatus.hidden=true;
 }catch{for(const [element,children]of fallback)element.replaceChildren(...children);if(authorStatus){authorStatus.hidden=false;authorStatus.textContent='This page component could not be started.';}}};
 const stopAuthor=()=>{authorDisposed=true;authorAbort.abort();try{authorStop?.();}finally{for(const [element,children]of fallback)element.replaceChildren(...children);}};
 window.addEventListener('pagehide',event=>{if(!event.persisted)stopAuthor();});void startAuthor();`;
}
