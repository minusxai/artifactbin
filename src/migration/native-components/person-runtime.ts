/** Exact dataset response decoding; omitted/deleted/unselected users are absent. */
export function nativePersonProjection(id:string,people:unknown):{id:string;name:string;handle:string|null;image:string|null}|null {
 if(!Array.isArray(people)||people.length>1)throw Error('Invalid person response');
 if(!people.length)return null;
 const card=people[0];
 if(!card||card.id!==id||typeof card.name!=='string'||!(card.handle===null||typeof card.handle==='string')||!(card.image===null||typeof card.image==='string'))throw Error('Invalid person response');
 return {id:card.id,name:card.name,handle:card.handle,image:card.image};
}
export const NATIVE_PERSON_RUNTIME=String.raw`function installPerson(client,doc,at,plan,project){
 const states=new WeakMap();
 return function renderPerson(host,id,scope){
  let state=states.get(host);
  if(state?.id===id&&state.scope===scope)return;
  state?.stop();
  host.person=null;host.error=null;host.loading=false;host.identityState='unknown';
  const next={id,scope,active:true,sub:null,stop:()=>{next.active=false;next.sub?.unsubscribe();scope.cleanups.delete(next.stop);host.person=null;host.loading=false;host.error=null;host.identityState='unknown';}};
  states.set(host,next);scope.cleanups.add(next.stop);
  if(id===null||id===undefined||id==='')return;
  if(typeof id!=='string'||!/^usr_[A-Za-z0-9]+$/.test(id)){host.error='Person unavailable';return;}
  host.loading=true;
  const unavailable=()=>{if(!next.active||!scope.active)return;host.person=null;host.loading=false;host.error='Person unavailable';};
  try{next.sub=client.watchQuery({query:doc('query NativePerson($ids:[ID!]!){'+plan.people.namespace+'{people(ids:$ids){id name handle image}}}'),variables:{ids:[id]},clearOnRefresh:true}).subscribe(result=>{
   if(!next.active||!scope.active)return;
   host.person=null;host.error=null;host.loading=!!result.loading;host.identityState='unknown';
   if(result.errors?.length){unavailable();return;}
   const cards=at(result.data,[plan.people.namespace,'people']);
   if(result.loading)return;
   try{host.person=project(id,cards);host.loading=false;host.identityState=host.person?'unknown':'missing';}catch{unavailable();}
  });}catch{unavailable();}
 };
}`;
