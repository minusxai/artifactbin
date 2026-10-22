import {controlLiteral} from './data-controls.ts';
import {readLocalReactiveExpression} from './reactive-source.ts';
import type {LocalDynamicIdentityPlan,LocalIdentityRegion} from './reactive-source-contracts.ts';
/** Derive deferred structure from source, never from the compiler's HTML. The
 * source admission walk separately validates every expression and attribute. */
export function readLocalIdentityPlan(tree:unknown,viewer=false):LocalDynamicIdentityPlan {
  const visit=(node:any,depth=0):LocalIdentityRegion[]=>{
    if(!node||depth>128)throw Error('Identity structure limit');
    if(node.type==='JSXFragment')return node.children.flatMap((n:any)=>visit(n,depth+1));
    if(node.type==='JSXText')return [];
    if(node.type==='JSXExpressionContainer')return visit(node.expression,depth+1);
    if(node.type==='ConditionalExpression'||(node.type==='LogicalExpression'&&node.operator==='&&'&&['JSXElement','JSXFragment','ConditionalExpression'].includes(node.right?.type))){
      const and=node.type==='LogicalExpression';const read=readLocalReactiveExpression(and?node.left:node.test);if(!read || read.signals.some(name => name.includes('.') && !(viewer && name==='_me.id')))throw Error('Identity condition requires local scalar reads');
      return [{kind:'conditional',test:read.expression,yes:visit(and?node.right:node.consequent,depth+1),no:and?[]:visit(node.alternate,depth+1)}];
    }
    if(node.type!=='JSXElement')return [];
    const name=node.openingElement.name.name;
    if(['Helmet','Import','Value','Query','Mutation'].includes(name))return [];
    const attr=(key:string)=>{const a=node.openingElement.attributes.find((a:any)=>a.name?.name===key);return a?controlLiteral(a.value):undefined;};
    const id=attr('id');
    if(name==='User')return typeof id==='string'?[{kind:'deferred',children:[{kind:'node',id}]}]:[];
    if(name==='DataTable' && node.children.some((n:any)=>n.type==='JSXElement' && n.openingElement.name.name==='Column')){
      const regions:LocalIdentityRegion[]=typeof id==='string'?[{kind:'node',id}]:[];
      const data=attr('data');
      for(const column of node.children.filter((n:any)=>n.type==='JSXElement')){
        const columnAttr=(key:string)=>{const a=column.openingElement.attributes.find((a:any)=>a.name?.name===key);return a?controlLiteral(a.value):undefined;};
        const header=columnAttr('id');if(typeof header==='string')regions.push({kind:'deferred',children:[{kind:'node',id:header}]});
        const children=column.children.flatMap((n:any)=>visit(n,depth+1));
        if(children.length){
          const rowKey=attr('rowKey'),col=columnAttr('col');
          if(typeof id!=='string'||typeof data!=='string'||typeof rowKey!=='string'||typeof col!=='string')throw Error('Durable Column identity required');
          regions.push({kind:'cell',owner:id,table:data.slice(1),rowKey,column:col,children});
        }
      }
      return regions;
    }
    if(name==='For'){
      const each=node.openingElement.attributes.find((a:any)=>a.name?.name==='each')?.value?.expression;
      if(each?.type!=='Identifier'||typeof id!=='string'||typeof attr('keyBy')!=='string')throw Error('Keyed identity repeat');
      return [{kind:'repeat',owner:id,table:each.name.slice(1),keyBy:attr('keyBy') as string,children:node.children.flatMap((n:any)=>visit(n,depth+1))}];
    }
    return [...(typeof id==='string'?[{kind:'node' as const,id}]:[]),...node.children.flatMap((n:any)=>visit(n,depth+1))];
  };
  return {regions:visit(tree)};
}

/** Branch previews may depend on admitted scalar defaults and scoped rows,
 * never a table object or a server query snapshot the source does not own. */
export function validIdentityConditions(plan:LocalDynamicIdentityPlan,declarations:readonly import('./local-contracts.ts').LocalDeclaration[],viewer=false):boolean {
  const scalar=(expression:import('./reactive-source-contracts.ts').LocalReactiveExpression):boolean=>{
    if(expression.kind==='signal')return (viewer&&expression.name==='_me.id')||declarations.some(d=>d.name===expression.name&&d.type!=='table');
    if(expression.kind==='not')return scalar(expression.value);
    if(expression.kind==='binary')return scalar(expression.left)&&scalar(expression.right);
    return true;
  };
  const visit=(regions:readonly LocalIdentityRegion[]):boolean=>regions.every(region=>region.kind==='node'||(region.kind==='repeat'||region.kind==='cell'||region.kind==='deferred'?visit(region.children):scalar(region.test)&&visit(region.yes)&&visit(region.no)));
  return visit(plan.regions);
}
