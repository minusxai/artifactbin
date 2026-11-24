/** Native head declarations use the same narrow HTTPS-origin grammar as consent grants. */
import {attribute,parseSource} from './html-source.ts';
import {cspExtensionsOf} from '../document/csp-extensions.ts';
export type NativeCspDeclaration = ReturnType<typeof cspExtensionsOf>;
export function nativeCspDeclarations(source:string|ReturnType<typeof parseSource>):NativeCspDeclaration {
 const document=typeof source==='string'?parseSource(source):source;
 const meta=document.elements.filter(element=>element.tagName==='meta'&&element.parentNode===document.head)
  .map(element=>({name:attribute(element,'name')??'',content:attribute(element,'content')??''}));
 const result=cspExtensionsOf({meta});
 const seen=new Set<string>();
 const duplicates:typeof meta=[];
 for(const item of meta){if(!item.name.startsWith('csp-'))continue;if(seen.has(item.name))duplicates.push(item);else seen.add(item.name);}
 if(duplicates.length)return {ok:false,extensions:result.extensions,errors:[...(!result.ok?result.errors:[]),...duplicates.map(item=>({message:`Duplicate native head meta ${item.name}`,tag:'meta',attr:'name',value:item.name}))]};
 return result;
}
