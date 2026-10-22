import {Parser} from 'acorn';
import jsx from 'acorn-jsx';
import {sourceValueDeclaration} from './source-manifest.ts';
import {historicalSourceValueDeclaration} from './historical-bound-value.ts';
import {readContextReferences} from './context-source.ts';
import {readStaticMermaidPlans} from './mermaid-source.ts';
import {readsLegacyViewerMarkup} from './viewer-source.ts';
import {readSlideDeckPlan} from './slide-deck.ts';
import type {CompiledMigrationInput} from './contracts.ts';
import type {AdmittedLocalSource} from './source-admission-contracts.ts';
/** Offline policy extracts runtime authority and state; the archived compiler
 * owns presentation syntax, components and executable browser expressions. */
export function readPrototypeSource(input:CompiledMigrationInput,backendLinks:ReadonlyMap<string,string>,historical:boolean):AdmittedLocalSource {
 const text='<>'+input.source+'</>',tree=Parser.extend(jsx()).parseExpressionAt(text,0,{ecmaVersion:'latest'}) as any;
 if(tree.end!==text.length)throw Error('Incomplete source');
 const declarations:import('./local-contracts.ts').LocalDeclaration[]=[],names=new Set<string>(),queries=new Set<string>(),imports=new Set<string>(),mutations=new Set<string>(),identities=new Set<string>();
 let chartCount=0,vegaCount=0;
 const name=(v:unknown):v is string=>typeof v==='string'&&/^[A-Za-z][A-Za-z0-9_]*$/.test(v)&&!['constructor','prototype','__proto__'].includes(v);
 function walk(node:any):void {
  if(!node||typeof node!=='object')return;
  if(node.type==='JSXElement'){
   const tag=node.openingElement.name.name,attrs=Object.fromEntries(node.openingElement.attributes.map((a:any)=>[a.name?.name,a.value?.value]));
   if(typeof attrs.id==='string'&&attrs.id)identities.add(attrs.id);
   if(tag==='Value'){
    const d=historical&&Object.hasOwn(attrs,'source')?historicalSourceValueDeclaration(node):sourceValueDeclaration(node,input.boundValueColumns??[]);
    if(!name(d.name)||names.has(d.name))throw Error('Duplicate value');names.add(d.name);declarations.push(d);
   }
   if(tag==='Query'){if(!name(attrs.name)||queries.has(attrs.name))throw Error('Invalid query');queries.add(attrs.name);}
   if(tag==='Import'){
    if(!name(attrs.name)||imports.has(attrs.name)||typeof attrs.src!=='string'||!/^ref:[A-Za-z0-9]{6,12}$/.test(attrs.src)||(!historical&&!(input.datasetBindings??[]).some(b=>b.name===attrs.name&&b.legacyRef===attrs.src)))throw Error('Unbound import');imports.add(attrs.name);
   }
   if(tag==='Mutation'){
    const binding=(input.datasetMutations??[]).find(b=>b.name===attrs.name);
    if(!name(attrs.name)||mutations.has(attrs.name)||(!historical&&!binding))throw Error('Unbound mutation');
    const reset=typeof attrs.reset==='string'?attrs.reset.trim().split(/\s+/).filter(Boolean):[];
    if(!historical&&JSON.stringify(reset)!==JSON.stringify(binding?.reset??[]))throw Error('Mutation reset differs');mutations.add(attrs.name);
   }
   if(tag==='Chart'||tag==='Question'){chartCount++;const kind=node.openingElement.attributes.find((a:any)=>a.name?.name==='viz')?.value?.expression?.properties?.find((p:any)=>(p.key?.name??p.key?.value)==='kind')?.value?.value??'table';if(!['table','single_value'].includes(kind))vegaCount++;}
  }
  for(const [k,v]of Object.entries(node)){if(k==='start'||k==='end')continue;if(Array.isArray(v))v.forEach(walk);else if(v&&typeof v==='object')walk(v);}
 }
 walk(tree);
 if((!historical&&imports.size!==(input.datasetBindings??[]).length)||(!historical&&mutations.size!==(input.datasetMutations??[]).length)||[...queries].some(n=>names.has(n))||[...imports].some(n=>names.has(n)||queries.has(n))||[...mutations].some(n=>names.has(n)||queries.has(n)||imports.has(n)))throw Error('Runtime names differ');
 if((input.boundValueColumns??[]).some(p=>!names.has(p.valueName))||(input.personBindings??[]).some(p=>declarations.find(d=>d.name===p.valueName)?.type!=='user'))throw Error('Bound value differs');
 let contexts:CompiledMigrationInput['contexts']=[],mermaids:CompiledMigrationInput['mermaids']=[],slideDeck:CompiledMigrationInput['slideDeck'];
 try{contexts=readContextReferences(tree);}catch{/* Compiler owns unsupported presentation. */}
 try{mermaids=readStaticMermaidPlans(tree);}catch{/* Use the archived component when no static adapter applies. */}
 try{slideDeck=readSlideDeckPlan(tree);}catch{/* Use compiled presentation behavior. */}
 const dynamicIdentities={regions:[]};
 return {sourceAdmission:'offline-prototype',input:{...input,sourceAdmission:'offline-prototype',viewerUnavailable:historical&&readsLegacyViewerMarkup(input.source),contexts,mermaids,slideDeck,dataControls:[],presentationIdentities:[],dynamicIdentities},manifest:{declarations},renderedIdentities:identities,dynamicIdentities,historical,backendLinks,queryNames:queries,datasetNames:imports,mutationNames:mutations,chartCount,vegaCount,author:input.authorPlan,authorProps:[]};
}
