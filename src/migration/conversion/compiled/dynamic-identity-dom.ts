import type {DynamicIdentityController} from './dynamic-identity-contracts.ts';
import type {LocalDynamicIdentityPlan,LocalIdentityRegion} from './reactive-source-contracts.ts';
import {archivedInstanceId} from './dynamic-identities.ts';
/** Install before hydration; flush after it. Async violations stop observation and
 * report to the caller. No collision repair ever changes an authored DOM id. */
export function installDynamicIdentities(root:Document|Element,plan:LocalDynamicIdentityPlan,onError:(error:Error)=>void):DynamicIdentityController {
  const direct=new Set<string>();
  const repeated=new Map<string,string>();
  const sourceIds=new Set<string>();
  function source(id:string){if(!id||sourceIds.has(id))throw Error('Duplicate dynamic source identity');sourceIds.add(id);}
  function collect(regions:readonly LocalIdentityRegion[],owner?:string){for(const region of regions){
    if(region.kind==='node'){
      source(region.id);
      if(owner)repeated.set(region.id,owner);else direct.add(region.id);
    }else if(region.kind==='conditional'){collect(region.yes,owner);collect(region.no,owner);}
    else {if(owner)throw Error('Nested repeat identity unsupported');source(region.owner);direct.add(region.owner);collect(region.children,region.owner);}
  }}
  collect(plan.regions);
  const assigned=new WeakMap<Element,string>();
  let disposed=false;
  function permitted(id:string):boolean{
    if(direct.has(id))return true;
    if(!id.startsWith('mx-instance-'))return false;
    try{
      const decoded:unknown=JSON.parse(decodeURIComponent(id.slice(12)));
      if(!Array.isArray(decoded)||decoded.length!==2)return false;
      const [scope,source]=decoded;
      if(typeof source!=='string'||!Array.isArray(scope)||scope.length!==4)return false;
      const [tag,owner,type,key]=scope;
      if(tag!=='repeat'||repeated.get(source)!==owner)return false;
      if(!(type==='number'&&typeof key==='number'&&Number.isFinite(key))&&!(type==='string'&&typeof key==='string'&&key.length<=256&&!/[\u0000-\u001f]/.test(key)))return false;
      return archivedInstanceId(scope,source)===id;
    }catch{return false;}
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
      if(id&&permitted(id)){
        if(ids.get(id)!.length!==1)throw Error('Duplicate dynamic DOM identity');
        target=id;
      }else if(id&&(repeated.has(id)||id.startsWith('mx-instance-')))throw Error('Invalid dynamic DOM identity');
      else if(assigned.has(element))target=null;
      if(target){if(identities.has(target))throw Error('Duplicate platform identity');identities.set(target,element);}
      proposed.set(element,target);
    }
    // Validate the complete tree before writing any attributes.
    for(const [element,target] of proposed){
      if(target!==element.getAttribute('data-af-id')){
        if(target===null)element.removeAttribute('data-af-id');else element.setAttribute('data-af-id',target);
      }
      if(element.getAttribute('id')===target&&target&&permitted(target))assigned.set(element,target);
    }
  }
  const observer=new MutationObserver(()=>{try{flush();}catch(error){observer.disconnect();disposed=true;onError(error instanceof Error?error:new Error('Invalid dynamic identities'));}});
  observer.observe(root,{subtree:true,childList:true,attributes:true,attributeFilter:['id','data-af-id']});
  return {flush,dispose(){disposed=true;observer.disconnect();}};
}
