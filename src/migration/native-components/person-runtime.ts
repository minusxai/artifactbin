/** Exact dataset response decoding; omitted/deleted/unselected users are absent. */
export function nativePersonProjection(id:string,people:unknown):{id:string;name:string;handle:string|null;image:string|null}|null {
 if(!Array.isArray(people)||people.length>1)throw Error('Invalid person response');
 if(!people.length)return null;
 const card=people[0];
 if(!card||card.id!==id||typeof card.name!=='string'||!(card.handle===null||typeof card.handle==='string')||!(card.image===null||typeof card.image==='string'))throw Error('Invalid person response');
 return {id:card.id,name:card.name,handle:card.handle,image:card.image};
}
export const NATIVE_PERSON_RUNTIME=String.raw`function installPerson(client,doc,at,plan,project){
 const states=new WeakMap(),active=new Set();
 let subscription=null,signature='',generation=0,queued=false,replay=null;
 const clear=state=>{state.host.person=null;state.host.loading=false;state.host.error=null;state.host.identityState='unknown';};
 const schedule=()=>{if(queued)return;queued=true;queueMicrotask(flush);};
 const fail=()=>{for(const state of active){clear(state);state.host.error='Person unavailable';}};
 function flush(){
  queued=false;
  const ids=[...new Set([...active].map(state=>state.id))].sort(),nextSignature=JSON.stringify(ids);
  if(nextSignature===signature){replay?.();return;}
  signature=nextSignature;replay=null;const current=++generation;subscription?.unsubscribe();subscription=null;
  for(const state of active){clear(state);state.host.loading=true;}
  if(!ids.length)return;
  if(ids.length>10000){fail();return;}
  const batches=[];for(let offset=0;offset<ids.length;offset+=100)batches.push(ids.slice(offset,offset+100));
  const variables={},definitions=[],fields=[];
  for(let index=0;index<batches.length;index++){const key='ids'+index;variables[key]=batches[index];definitions.push('$'+key+':[ID!]!');fields.push((batches.length===1?'people':'batch'+index+':people')+'(ids:$'+key+'){id name handle image}');}
  const query='query NativePeople('+definitions.join(',')+'){'+plan.people.namespace+'{'+fields.join(' ')+'}}';
  try{subscription=client.watchQuery({query:doc(query),variables,clearOnRefresh:true}).subscribe(result=>{
   if(current!==generation)return;
   const apply=()=>{
   for(const state of active){clear(state);state.host.loading=!!result.loading;}
   if(result.errors?.length){fail();return;}
   if(result.loading)return;
   try{
    const cards=new Map();
    for(let index=0;index<batches.length;index++){
     const answer=at(result.data,[plan.people.namespace,batches.length===1?'people':'batch'+index]);
     if(!Array.isArray(answer)||answer.length>batches[index].length)throw Error('Invalid person response');
     for(const value of answer){if(!value||!batches[index].includes(value.id)||cards.has(value.id))throw Error('Invalid person response');cards.set(value.id,project(value.id,[value]));}
    }
    for(const state of active){state.host.person=cards.get(state.id)??null;state.host.identityState=state.host.person?'unknown':'missing';}
   }catch{fail();}
   };replay=apply;apply();
  });}catch{fail();}
 }
 return function renderPerson(host,id,scope){
  const previous=states.get(host);if(previous?.id===id&&previous.scope===scope)return;
  previous?.stop();
  const state={host,id,scope,stop:()=>{active.delete(state);scope.cleanups.delete(state.stop);clear(state);if(!active.size){generation++;subscription?.unsubscribe();subscription=null;signature='';}schedule();}};
  states.set(host,state);clear(state);scope.cleanups.add(state.stop);
  if(id===null||id===undefined||id==='')return;
  if(typeof id!=='string'||!/^usr_[A-Za-z0-9]+$/.test(id)){host.error='Person unavailable';return;}
  active.add(state);host.loading=true;schedule();
 };
}`;
