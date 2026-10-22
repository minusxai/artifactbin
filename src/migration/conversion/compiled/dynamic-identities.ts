import type {DynamicIdentityValues} from './dynamic-identity-contracts.ts';
import type {LocalDynamicIdentityPlan,LocalIdentityRegion,LocalReactiveExpression} from './reactive-source-contracts.ts';
/** Exact archived durable-row encoding. Numeric and string keys remain distinct. */
export function archivedInstanceId(scope:unknown,sourceId:string):string {
  return `mx-instance-${encodeURIComponent(JSON.stringify([scope,sourceId]))}`;
}
function own(record:Readonly<Record<string,unknown>>|undefined,key:string):unknown {
  return record && Object.hasOwn(record,key) ? record[key] ?? null : null;
}
export function evaluateLocalReactiveExpression(expr:LocalReactiveExpression,context:DynamicIdentityValues):unknown {
  switch(expr.kind){
    case 'literal':return expr.value;
    case 'signal':return own(context.values,expr.name);
    case 'row':return own(context.row,expr.field);
    case 'not':return !evaluateLocalReactiveExpression(expr.value,context);
    case 'binary':{
      const left=evaluateLocalReactiveExpression(expr.left,context);
      if(expr.op==='&&')return left && evaluateLocalReactiveExpression(expr.right,context);
      if(expr.op==='||')return left || evaluateLocalReactiveExpression(expr.right,context);
      const right=evaluateLocalReactiveExpression(expr.right,context);
      if(expr.op!=='==='&&expr.op!=='!=='&& !((typeof left==='number'&&typeof right==='number')||(typeof left==='string'&&typeof right==='string')))return false;
      // Archived relational operators compare only matching number/string types.
      switch(expr.op){
        case '===':return left===right;
        case '!==':return left!==right;
        case '<':return (left as number)<(right as number);
        case '<=':return (left as number)<=(right as number);
        case '>':return (left as number)>(right as number);
        case '>=':return (left as number)>=(right as number);
      }
    }
  }
}
/** Compiler preview deliberately renders no repeat rows. Deferred templates are
 * provenance, not DOM targets until the archived runtime emits keyed instances. */
function resolveInitialIdentities(plan:LocalDynamicIdentityPlan,values:Readonly<Record<string,unknown>>,includeDeferred:boolean):string[]{
  const result:string[]=[];
  const visit=(regions:readonly LocalIdentityRegion[])=>{for(const region of regions){
    if(region.kind==='node')result.push(region.id);
    else if(region.kind==='repeat')result.push(region.owner);
    else if(region.kind==='cell')continue;
    else if(region.kind==='deferred'){if(includeDeferred)visit(region.children);}
    else visit(evaluateLocalReactiveExpression(region.test,{values})?region.yes:region.no);
  }};
  visit(plan.regions);
  if(new Set(result).size!==result.length)throw new Error('Duplicate dynamic source identity');
  return result;
}

export function initialDynamicIdentities(plan:LocalDynamicIdentityPlan,values:Readonly<Record<string,unknown>>):string[]{return resolveInitialIdentities(plan,values,false);}
/** Deferred presentation may already exist as a hidden SSR shell. These IDs are
 * permitted if present, without requiring unrendered templates or branches. */
export function allowedInitialDynamicIdentities(plan:LocalDynamicIdentityPlan,values:Readonly<Record<string,unknown>>):string[]{return resolveInitialIdentities(plan,values,true);}
