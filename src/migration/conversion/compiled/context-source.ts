import type {CompiledContextReference} from './context-contracts.ts';
/** Exact frozen Helmet/Context grammar. No source evaluation or URL admission. */
export function readContextReferences(tree: unknown): readonly CompiledContextReference[] {
 const references: CompiledContextReference[]=[];
 let helmets=0;
 const visit=(node:any,parent?:any,depth=0):void=>{
  if(!node||typeof node!=='object')return;
  if(depth>128)throw Error('Context source depth');
  if(node.type==='JSXElement'){
   const tag=node.openingElement.name?.name;
   if(tag==='Helmet'&&(++helmets>1||parent!==tree))throw Error('Helmet placement');
   if(tag==='Context'){
    if(parent?.type!=='JSXElement'||parent.openingElement.name?.name!=='Helmet'||references.length)throw Error('Context placement');
    const attrs=node.openingElement.attributes;
    if(attrs.length!==1||attrs[0].type!=='JSXAttribute'||attrs[0].name?.name!=='src'||attrs[0].value?.type!=='Literal'||typeof attrs[0].value.value!=='string')throw Error('Context attributes');
    const match=/^ref:([A-Za-z0-9]{6,12})$/.exec(attrs[0].value.value);
    if(!match||node.children.some((child:any)=>child.type!=='JSXText'||child.value.trim()))throw Error('Context reference');
    references.push({legacyId:match[1]!});
   }
  }
  // Traverse the complete AST, including deferred expressions: placement must be structural.
  for(const [key,value] of Object.entries(node)){
   if(key==='parent')continue;
   if(Array.isArray(value)){for(const child of value)if(child&&typeof child==='object')visit(child,node,depth+1);}
   else if(value&&typeof value==='object')visit(value,node,depth+1);
  }
 };
 visit(tree);return references;
}
