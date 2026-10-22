import{Parser}from'acorn';import jsx from'acorn-jsx';
import{MAX_COMPILED_SOURCE_BYTES}from'./contracts.ts';
import{analyzeLegacyBuiltin}from'./builtin-source.ts';
import type{LegacyMutationImportCatalog}from'../mutation-contracts.ts';
/** Only the archived reader's exact original-id scalar is a supported markup read. */
export function readsLegacyViewerMarkup(source:string):boolean{
 if(typeof source!=='string'||Buffer.byteLength(source)>MAX_COMPILED_SOURCE_BYTES)return false;
 try{const text='<>'+source+'</>';const tree=Parser.extend(jsx()).parseExpressionAt(text,0,{ecmaVersion:'latest'}) as any;if(tree.end!==text.length)return false;
 let found=false;const walk=(node:any)=>{if(!node||typeof node!=='object')return;if(node.type==='MemberExpression'&&!node.computed&&node.object?.type==='Identifier'&&node.object.name==='$_me'&&node.property?.type==='Identifier'&&node.property.name==='id')found=true;for(const v of Object.values(node))if(v&&typeof v==='object')Array.isArray(v)?v.forEach(walk):walk(v);};walk(tree);return found;
 }catch{return false;}
}
/** Registration detects exact parsed markup reads or a prepared physical SQL relation. */
export async function readsLegacyViewer(source:string,catalogs:readonly LegacyMutationImportCatalog[]=[]):Promise<boolean>{
 if(readsLegacyViewerMarkup(source))return true;
 try{return await analyzeLegacyBuiltin(source,'_me',catalogs);}catch{return false;}
}
