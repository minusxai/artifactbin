import {admitMermaid} from './mermaid-admission.ts';
import {controlLiteral} from './data-controls.ts';
import type {CompiledMermaidPlan} from './mermaid-contracts.ts';
/** Preparation can measure only static, initially present figure contexts. */
export function readStaticMermaidPlans(tree:unknown):readonly CompiledMermaidPlan[]{
 const plans:CompiledMermaidPlan[]=[];
 const visit=(n:any,dynamic=false,depth=0):void=>{
  if(!n||typeof n!=='object')return;if(depth>128)throw Error('Mermaid source depth');
  if(n.type==='JSXElement'){
   const tag=n.openingElement.name.name;
   if(tag==='Mermaid'){
    if(dynamic)throw Error('Deferred Mermaid context unsupported');
    const attrs:Record<string,unknown>=Object.create(null);
    for(const a of n.openingElement.attributes){if(a.type!=='JSXAttribute'||Object.hasOwn(attrs,a.name?.name))throw Error('Mermaid attributes');attrs[a.name.name]=controlLiteral(a.value);}
    plans.push(admitMermaid(attrs,n.children.some((c:any)=>c.type!=='JSXText'||c.value.trim())));
    if(plans.length>32)throw Error('Mermaid count limit');
   }
   for(const c of n.children)visit(c,dynamic||tag==='For'||tag==='Repeat'||tag==='Column',depth+1);
  }else if(n.type==='JSXFragment')for(const c of n.children)visit(c,dynamic,depth+1);
  else if(n.type==='JSXExpressionContainer')visit(n.expression,true,depth+1);
  else if(n.type==='ConditionalExpression'){visit(n.consequent,true,depth+1);visit(n.alternate,true,depth+1);}
  else if(n.type==='LogicalExpression')visit(n.right,true,depth+1);
 };
 visit(tree);return plans;
}
