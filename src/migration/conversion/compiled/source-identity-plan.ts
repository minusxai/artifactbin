import {controlLiteral} from './data-controls.ts';
import {readLocalReactiveExpression} from './reactive-source.ts';
import type {LocalDynamicIdentityPlan,LocalIdentityRegion} from './reactive-source-contracts.ts';
/** Derive deferred structure from source, never from the compiler's HTML. The
 * source admission walk separately validates every expression and attribute. */
export function readLocalIdentityPlan(tree:unknown):LocalDynamicIdentityPlan {
  const visit=(node:any,depth=0):LocalIdentityRegion[]=>{
    if(!node||depth>128)throw Error('Identity structure limit');
    if(node.type==='JSXFragment')return node.children.flatMap((n:any)=>visit(n,depth+1));
    if(node.type==='JSXText')return [];
    if(node.type==='JSXExpressionContainer')return visit(node.expression,depth+1);
    if(node.type==='ConditionalExpression'||(node.type==='LogicalExpression'&&node.operator==='&&'&&['JSXElement','JSXFragment','ConditionalExpression'].includes(node.right?.type))){
      const and=node.type==='LogicalExpression';const read=readLocalReactiveExpression(and?node.left:node.test);if(!read || read.signals.some(name => name.includes('.')))throw Error('Identity condition requires local scalar reads');
      return [{kind:'conditional',test:read.expression,yes:visit(and?node.right:node.consequent,depth+1),no:and?[]:visit(node.alternate,depth+1)}];
    }
    if(node.type!=='JSXElement')return [];
    const name=node.openingElement.name.name;
    if(['Helmet','Import','Value','Query','Mutation'].includes(name))return [];
    const attr=(key:string)=>{const a=node.openingElement.attributes.find((a:any)=>a.name?.name===key);return a?controlLiteral(a.value):undefined;};
    const id=attr('id');
    if(name==='For'){
      const each=node.openingElement.attributes.find((a:any)=>a.name?.name==='each')?.value?.expression;
      if(each?.type!=='Identifier'||typeof id!=='string'||typeof attr('keyBy')!=='string')throw Error('Keyed identity repeat');
      return [{kind:'repeat',owner:id,table:each.name.slice(1),keyBy:attr('keyBy') as string,children:node.children.flatMap((n:any)=>visit(n,depth+1))}];
    }
    return [...(typeof id==='string'?[{kind:'node' as const,id}]:[]),...node.children.flatMap((n:any)=>visit(n,depth+1))];
  };
  return {regions:visit(tree)};
}
