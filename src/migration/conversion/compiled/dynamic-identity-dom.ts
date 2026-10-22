import type {DynamicIdentityController,DynamicIdentityOwnership,DynamicIdentityScope} from './dynamic-identity-contracts.ts';
import type {LocalDynamicIdentityPlan,LocalIdentityRegion} from './reactive-source-contracts.ts';
import {archivedInstanceId} from './dynamic-identities.ts';
/** Install before hydration; flush after it. Async violations stop observation and
 * report to the caller. No collision repair ever changes an authored DOM id. */
export function installDynamicIdentities(root:Document|Element,plan:LocalDynamicIdentityPlan,onError:(error:Error)=>void):DynamicIdentityController {
  const direct=new Set<string>();
  type Scope=DynamicIdentityScope;
  const scopeOwners=new Set<string>();
  const repeated=new Map<string,Scope>();
  const sourceIds=new Set<string>();
  function source(id:string){if(!id||sourceIds.has(id))throw Error('Duplicate dynamic source identity');sourceIds.add(id);}
  function collect(regions:readonly LocalIdentityRegion[],scope?:Scope){for(const region of regions){
    if(region.kind==='node'){
      source(region.id);
      if(scope)repeated.set(region.id,scope);else direct.add(region.id);
    }else if(region.kind==='conditional'){collect(region.yes,scope);collect(region.no,scope);}
    else if(region.kind==='deferred')collect(region.children,scope);
    else {if(scope)throw Error('Nested instance identity unsupported');scopeOwners.add(region.owner);
      if(region.kind==='repeat'){source(region.owner);direct.add(region.owner);collect(region.children,{tag:'repeat',owner:region.owner});}
      else collect(region.children,{tag:'table',owner:region.owner,column:region.column});
    }
  }}
  collect(plan.regions);
  const assigned=new WeakMap<Element,string>();
  let disposed=false;
  function ownership(id:string):DynamicIdentityOwnership{
    if(direct.has(id))return 'page';
    if(!id.startsWith('mx-instance-'))return repeated.has(id)?'invalid':'unrelated';
    try{
      const decoded:unknown=JSON.parse(decodeURIComponent(id.slice(12)));
      if(!Array.isArray(decoded)||decoded.length!==2)return 'invalid';
      const [scope,source]=decoded;
      if(typeof source!=='string'||!source||!Array.isArray(scope))return 'invalid';
      const [tag,owner,type,key,column]=scope;
      if(typeof owner!=='string'||!owner||!(tag==='repeat'&&scope.length===4||tag==='table'&&scope.length===5&&typeof column==='string'&&column.length>0))return 'invalid';
      if(!(type==='number'&&typeof key==='number'&&Number.isFinite(key))&&!(type==='string'&&typeof key==='string'&&key.length<=256&&!/[\u0000-\u001f]/.test(key)))return 'invalid';
      if(archivedInstanceId(scope,source)!==id)return 'invalid';
      const expected=repeated.get(source);
      if(!sourceIds.has(source)&&!sourceIds.has(owner)&&!scopeOwners.has(owner))return 'unowned-instance';
      if(!expected||tag!==expected.tag||owner!==expected.owner||(tag==='table'&&column!==expected.column))return 'invalid';
      return 'page';
    }catch{return 'invalid';}
  }
  function flush(){
    if(disposed)return;
    const elements=[...(root instanceof Element?[root]:[]),...root.querySelectorAll('[id],[data-af-id]')];
    const ids=new Map<string,Element[]>();
    for(const element of elements){const id=element.getAttribute('id');if(id){const list=ids.get(id)??[];list.push(element);ids.set(id,list);}}
    const proposed=new Map<Element,string|null>();
    const identities=new Map<string,Element>();
    for(const element of elements){
      const id=element.getAttribute('id');
      let target=element.getAttribute('data-af-id');
      const kind=id?ownership(id):'unrelated';
      if(id&&kind==='page'){
        if(ids.get(id)!.length!==1)throw Error('Duplicate dynamic DOM identity');
        target=id;
      }else if(kind==='invalid')throw Error('Invalid dynamic DOM identity');
      else if(kind==='unowned-instance')target=null;
      else if(assigned.has(element))target=null;
      if(target){if(identities.has(target))throw Error('Duplicate platform identity');identities.set(target,element);}
      proposed.set(element,target);
    }
    // Validate the complete tree before writing any attributes.
    for(const [element,target] of proposed){
      if(target!==element.getAttribute('data-af-id')){
        if(target===null)element.removeAttribute('data-af-id');else element.setAttribute('data-af-id',target);
      }
      if(element.getAttribute('id')===target&&target&&ownership(target)==='page')assigned.set(element,target);
    }
  }
  const observer=new MutationObserver(()=>{try{flush();}catch(error){observer.disconnect();disposed=true;onError(error instanceof Error?error:new Error('Invalid dynamic identities'));}});
  observer.observe(root,{subtree:true,childList:true,attributes:true,attributeFilter:['id','data-af-id']});
  return {flush,dispose(){disposed=true;observer.disconnect();}};
}
