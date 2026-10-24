/** Ordinary author JavaScript, embedded in the emitted module. No platform
 * runtime extension, source evaluation, network authority or shared-state cache. */
import {NATIVE_PERSON_RUNTIME} from './person-runtime.ts';
import { NATIVE_TABLE_RUNTIME } from './table-runtime.ts';
export const NATIVE_BINDINGS_RUNTIME = String.raw`function install(client,gql,document,plan,evaluate,normalizeTimestamp,formatCell,projectPerson){
 const requestId=()=>{if(typeof crypto.randomUUID==='function')return crypto.randomUUID();const bytes=crypto.getRandomValues(new Uint8Array(16));bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;const hex=[...bytes].map(byte=>byte.toString(16).padStart(2,'0')).join('');return hex.slice(0,8)+'-'+hex.slice(8,12)+'-'+hex.slice(12,16)+'-'+hex.slice(16,20)+'-'+hex.slice(20);};
 const createTable=(${NATIVE_TABLE_RUNTIME}),tableBindings=new WeakMap();
 let disposed=false,values={},tables={},tableData={},tablePending={},tableErrors={},localSub,viewerSub,viewerId,viewerReady=false,failed=false;
 const cells=new WeakMap(),completions=new Map(),committedResets=new Set();
 const subscriptions=new Map(),conditions=new WeakMap(),loops=new WeakMap(),actions=new WeakMap(),pending=new Map(),requestOwners=new WeakMap(),controls=new WeakMap(),operationLocks=new Set(),topActions=new Set();
 const operationBusy=(name,busy)=>{if(busy)operationLocks.add(name);else operationLocks.delete(name);for(const item of topActions)if(item.run===name){if(busy)item.beforeBusy=item.host.disabled;item.host.disabled=busy?true:item.beforeBusy;if(busy)item.host.setAttribute('aria-busy','true');else item.host.removeAttribute('aria-busy');}};
 const rootScope={active:true,cleanups:new Set(),completion:{active:true},ownsCompletion:true},scopes=new Set([rootScope]);
 const disposeScope=scope=>{if(scope.ownsCompletion){scope.completion.active=false;if(scope.completion.key&&completions.get(scope.completion.key)===scope.completion)completions.delete(scope.completion.key);}if(!scope.active)return;scope.active=false;for(const cleanup of scope.cleanups)cleanup();scope.cleanups.clear();scopes.delete(scope);};
 const childScope=(parent,retained=false)=>{const child={active:true,cleanups:new Set(),completion:retained?parent.completion:{active:true},ownsCompletion:!retained},cleanup=()=>disposeScope(child);parent.cleanups.add(cleanup);child.cleanups.add(()=>parent.cleanups.delete(cleanup));scopes.add(child);return child;};
 const clearCondition=host=>{const branch=conditions.get(host);if(branch?.scope){disposeScope(branch.scope);branch.scope=null;}host.replaceChildren();};
 const own=(record,key)=>record&&Object.hasOwn(record,key)?record[key]??null:null;
 const at=(record,path)=>path.reduce((value,key)=>own(value,key),record);
 const doc=source=>gql([source]);
 const observers=new Set();let observerQueued=false;
 const observerSnapshot=()=>Object.freeze({active:!disposed,values:Object.freeze({...values}),queries:Object.freeze(Object.fromEntries(plan.queries.map(query=>[query.name,Object.freeze({rows:tables[query.name]?Object.freeze(tables[query.name].map(row=>Object.freeze({...row}))):null,loading:!!tablePending[query.name],error:tableErrors[query.name]??null})])))});
 const notifyObservers=()=>{if(disposed||observerQueued)return;observerQueued=true;queueMicrotask(()=>{observerQueued=false;if(disposed)return;const snapshot=observerSnapshot();for(const listener of [...observers])listener(snapshot);});};
 const observe=listener=>{if(disposed){listener({active:false,values:{},queries:{}});return()=>{};}observers.add(listener);listener(observerSnapshot());return()=>observers.delete(listener);};
 const renderPerson=(${NATIVE_PERSON_RUNTIME})(client,doc,at,plan,projectPerson);
 const error=message=>{if(disposed)return;const notice=document.createElement('p');notice.setAttribute('role','alert');notice.textContent=message;document.body.append(notice);};
 const read=(expr,row)=>evaluate(expr,{values:{...values,...tables,...(viewerReady?{'_me.id':viewerId}:{})},row});
 const bindingId=node=>node.getAttribute?.('data-native-binding-id')||node.getAttribute?.('data-af-id');
 const all=root=>[...(bindingId(root)?[root]:[]),...(root.querySelectorAll?.('[data-af-id],[data-native-binding-id]')??[])];
 const lookup=(root,id)=>{const found=all(root).filter(node=>bindingId(node)===id);if(found.length>1)throw Error('Duplicate binding identity');return found[0];};
 const remap=(roots,context)=>{if(!context?.ids)return roots;const {ids,domIds,domBindings,durable}=context;
  for(const root of roots)for(const node of all(root)){const id=node.getAttribute('data-af-id');if(!Object.hasOwn(ids,id))throw Error('Unplanned repeated identity');const domId=node.getAttribute('id');if(domId){if(!Object.hasOwn(domIds,domId))throw Error('Missing repeated DOM identity mapping');if(domBindings[domId]!==id)throw Error('Repeated DOM identity mapping mismatch');node.setAttribute('id',domIds[domId]);}if(durable)node.setAttribute('data-af-id',ids[id]);else{node.removeAttribute('data-af-id');node.setAttribute('data-native-binding-id',ids[id]);}
   for(const attr of ['for','aria-labelledby','aria-describedby','aria-controls','aria-owns','aria-details','aria-activedescendant','aria-errormessage','headers','list','form']){const value=node.getAttribute(attr);if(value)node.setAttribute(attr,value.split(/\s+/).map(id=>Object.hasOwn(domIds,id)?domIds[id]:id).join(' '));}
   for(const attr of ['href','xlink:href']){const value=node.getAttribute(attr);if(value?.startsWith('#')&&Object.hasOwn(domIds,value.slice(1)))node.setAttribute(attr,'#'+domIds[value.slice(1)]);}
  }return roots;
 };
 const clone=(id,context)=>{const template=document.getElementById(id);if(!template||!template.content)throw Error('Missing binding template');return remap([...template.content.childNodes].map(child=>child.cloneNode(true)),context);};
 const stopQueries=()=>{for(const item of subscriptions.values()){item.active=false;item.sub?.unsubscribe();}subscriptions.clear();};
 const scalar=value=>value===null||typeof value==='string'||typeof value==='boolean'||typeof value==='number'&&Number.isFinite(value);
 function decode(query,result){
  if(result.errors?.length)throw Error('Registered query failed');
  const answer=at(result.data,query.responsePath);if(!Array.isArray(answer))throw Error('Registered query response unavailable');
  const table=answer.find(item=>item.name===query.tableName);if(!table||table.error!==null)throw Error('Registered query failed');
  if(!Array.isArray(table.columns)||!Array.isArray(table.rows))throw Error('Invalid registered table');
  const names=new Set();for(const column of table.columns){if(!column||typeof column.name!=='string'||names.has(column.name)||['__proto__','prototype','constructor'].includes(column.name)||!['string','number','boolean','date','timestamp','user'].includes(column.type))throw Error('Invalid registered column');names.add(column.name);}
  const rows=table.rows.map(row=>{if(!Array.isArray(row.cells)||row.cells.length!==table.columns.length)throw Error('Invalid registered row');const record=Object.create(null);row.cells.forEach((cell,index)=>{const column=table.columns[index],key=column.type==='number'?'number':column.type==='boolean'?'boolean':'text';if(!cell||typeof cell.isNull!=='boolean'||!cell.isNull&&(typeof cell[key]!==({number:'number',boolean:'boolean',text:'string'})[key]||typeof cell[key]==='number'&&!Number.isFinite(cell[key])))throw Error('Invalid registered cell');record[column.name]=cell.isNull?null:cell[key];});return record;});return {columns:table.columns.map(column=>({...column})),rows};
 }
 function render(root=document,row,context,skip){
  const ids=context?.ids??{},scope=context?.scope??rootScope;
  if(disposed||failed||!scope.active)return;
  for(const target of plan.targets){if(target.sourceNode===skip)continue;const host=lookup(root,ids[target.afId]||target.afId);if(!host)continue;
   if(target.viewerIdentity){if(!viewerReady){if(target.kind==='condition')clearCondition(host);else {host.hidden=true;if(target.kind==='person')renderPerson(host,null,scope);}continue;}host.hidden=false;}
   if(target.kind==='person')renderPerson(host,read(target.expression,row),scope);
   if(target.kind==='text'){const value=read(target.expression,row);host.textContent=typeof value==='string'||typeof value==='number'?String(value):'';}
   if(target.kind==='cell'){
    let state=cells.get(host);if(!state){const child=document.createElement('span');host.replaceChildren(child);state={child,rows:null};cells.set(host,state);}
    const name=target.expression.name,busy=!!tablePending[name],current=tables[name]??null;
    if(current!==null||!busy)state.rows=current;
    state.child.textContent=formatCell(state.rows,target.format);
    state.child.setAttribute('aria-label',state.rows===null?'Number placeholder':'Live number');
    host.setAttribute('aria-busy',busy?'true':'false');
    if(busy)host.setAttribute('class','mx-busy-inline');else if(target.authorClass!==null)host.setAttribute('class',target.authorClass);else host.removeAttribute('class');
   }
   if(target.kind==='property'){
    const binding=target.writeback;let projection=target.property==='data'?tableData[target.expression.name]??null:read(target.expression,row);
    if(binding?.multiple){try{projection=projection===null?[]:JSON.parse(projection);if(!Array.isArray(projection))throw Error();}catch{error('Invalid multiple selection');projection=[];}}
    if(target.property==='options'){const table=tableData[target.expression.name],columns=table?.columns??[],value=columns[0]?.name,label=columns[1]?.name;projection=table&&value?table.rows.map(row=>({value:String(row[value]??''),label:label?String(row[label]??row[value]??''):String(row[value]??'')})):[];}
    host[target.property]=projection;
    if(binding){let bound=controls.get(host);if(!bound){bound=new Set();controls.set(host,bound);}if(!bound.has(target.property)){bound.add(target.property);
     const change=async event=>{if(disposed||failed||!scope.active||host.disabled||host.getAttribute('readonly')!==null||host.getAttribute('read-only')!==null||event.target!==host)return;
      try{let raw=binding.source==='detail.value'?event.detail?.value:binding.source==='target.checked'?host.checked:host.value,value;
       if(!binding.multiple&&!scalar(raw))throw Error('Invalid control value');
       if(binding.multiple){if(!Array.isArray(raw)||raw.some(item=>!scalar(item)||item===null))throw Error('Invalid multiple selection');value=JSON.stringify(raw.map(String));}
       else if(raw===null||raw==='')value=null;
       else if(binding.source==='target.checked')value=raw===true;
       else if(binding.scalarType==='number'){const number=Number(raw);value=Number.isFinite(number)?number:null;}
       else if(binding.scalarType==='boolean')value=raw===true||raw==='true';
       else if(binding.scalarType==='timestamp'){try{value=normalizeTimestamp(String(raw));}catch{value=null;}}
       else{if(!scalar(raw))throw Error('Invalid control value');value=String(raw);}
       if(!scalar(value)||value!==null&&typeof value!==plan.valueTypes[binding.valueName])throw Error('Invalid control value');
       await client.updateQuery({query:doc(plan.localQuery)},data=>disposed||!scope.active?data:({...data,[binding.valueName]:value}));
      }catch(cause){event.preventDefault?.();error(cause.message);}
     };host.addEventListener(binding.event,change);scope.cleanups.add(()=>{host.removeEventListener(binding.event,change);bound.delete(target.property);});
    }}
   }
   if(target.kind==='table'){
    let table=tableBindings.get(host);if(!table){table=createTable(host,target,{clone,render,childScope,disposeScope});tableBindings.set(host,table);}table.update(tableData[target.expression.name]??null,scope);
   }
   if(target.kind==='condition'){
    let branch=conditions.get(host);if(!branch){branch={nodes:clone(target.templateId,context),scope:null};conditions.set(host,branch);}
    const yes=!!read(target.expression,row);if(yes){if(!branch.scope?.active)branch.scope=childScope(scope,true);if(!host.childNodes.length)host.append(...branch.nodes);render(host,row,{...context,scope:branch.scope},target.sourceNode);}else clearCondition(host);
   }
   if(target.kind==='loop'){
    const rows=read(target.expression,row)??[],durable=target.identity.keyBy!==null;if(!Array.isArray(rows)||rows.length>10000)throw Error('Repeat source must be bounded rows');
    let state=loops.get(host);if(!state){state=new Map();loops.set(host,state);scope.cleanups.add(()=>{for(const item of state.values()){disposeScope(item.context.scope);item.host.remove();}state.clear();loops.delete(host);});}const keys=new Set(),desired=[];
    for(const [index,entry]of rows.entries()){const key=durable?own(entry,target.identity.keyBy):index;if(!(typeof key==='number'&&Number.isFinite(key)||typeof key==='string'&&key.length<=256&&!/[\u0000-\u001f]/.test(key)))throw Error('Missing stable row key');const encoded=JSON.stringify([typeof key,key]);if(keys.has(encoded))throw Error('Duplicate stable row key');keys.add(encoded);desired.push({entry,key,encoded});}
    for(const [key,item]of state)if(!keys.has(key)){disposeScope(item.context.scope);item.host.remove();state.delete(key);}
    for(const {entry,key,encoded}of desired){let item=state.get(encoded);if(!item){const wrapper=document.createElement('span');wrapper.setAttribute('style','display:contents');const mapping={};for(const sourceId of target.identity.templateIds)mapping[sourceId]='mx-instance-'+encodeURIComponent(JSON.stringify([['repeat',target.identity.owner,durable?typeof key:'index',key],sourceId]));const domMapping={},domBindings={};for(const entry of target.identity.domIds||[]){domBindings[entry.domId]=entry.templateAfId;domMapping[entry.domId]='mx-instance-'+encodeURIComponent(JSON.stringify([['repeat',target.identity.owner,durable?typeof key:'index',key],entry.domId]));}const rowScope=childScope(scope);rowScope.completion.key=JSON.stringify([context?.ids??null,target.identity.owner,encoded]);completions.set(rowScope.completion.key,rowScope.completion);const rowContext={ids:mapping,domIds:domMapping,domBindings,durable,scope:rowScope};wrapper.append(...clone(target.templateId,rowContext));item={host:wrapper,context:rowContext};state.set(encoded,item);}host.append(item.host);render(item.host,entry,item.context);}

   }
   if(target.kind==='action'){
    if(target.run&&plan.mutations.find(item=>item.name===target.run)?.mode==='historical-readonly'){host.disabled=true;host.setAttribute('aria-disabled','true');continue;}
    const existing=actions.get(host);if(existing){existing.row=row;if(!context?.ids&&target.run&&operationLocks.has(target.run))host.disabled=true;continue;}const action={row,host,run:target.run};actions.set(host,action);if(!context?.ids&&target.run)topActions.add(action);
    const click=async()=>{if(disposed||failed||!scope.active||host.disabled||action.busy||!context?.ids&&target.run&&operationLocks.has(target.run))return;action.busy=true;if(!context?.ids&&target.run)operationBusy(target.run,true);host.disabled=true;try{
     if(target.set){const patch={};for(const [name,expr]of Object.entries(target.set)){const value=read(expr,action.row);if(!scalar(value)||!plan.valueTypes[name]||value!==null&&typeof value!==plan.valueTypes[name])throw Error('Invalid local action value');patch[name]=value;}await client.updateQuery({query:doc(plan.localQuery)},data=>disposed||!scope.active?data:({...data,...patch}));}
     if(disposed||!scope.active)return;
     if(target.run){const mutation=plan.mutations.find(item=>item.name===target.run);let request=pending.get(host);if(request&&plan.viewer&&(!viewerReady||requestOwners.get(request)!==viewerId))throw Error('Viewer changed while a mutation outcome is unresolved');if(!request){const snapshot={};for(const field of mutation.values){const value=field.source?.kind==='row'?own(action.row,field.source.field):own(values,field.name);if(!scalar(value)||value===null&&field.nullable===false||value!==null&&typeof value!==({date:'string',timestamp:'string',user:'string'}[field.type]||field.type))throw Error('Invalid mutation argument');snapshot[field.name]=value;}request={requestId:requestId(),values:snapshot};pending.set(host,request);requestOwners.set(request,plan.viewer?viewerId:undefined);}const result=await client.mutate({mutation:doc(mutation.document),variables:request});
      if(result.errors?.length)throw Error('Mutation failed; local values were retained');const receipt=at(result.data,mutation.outcomePath);if(!receipt||receipt.requestId!==request.requestId||!['committed','rejected','unknown'].includes(receipt.outcome))throw Error('Mutation outcome unavailable; local values were retained');
      if(receipt.outcome==='unknown')throw Error('Mutation outcome unknown; retry keeps the original request');if(pending.get(host)===request)pending.delete(host);if(disposed||plan.viewer&&viewerReady&&requestOwners.get(request)!==viewerId)return;
      if(receipt.outcome==='rejected')throw Error('Mutation rejected; local values were retained');
      if(!Array.isArray(receipt.reset)||JSON.stringify([...receipt.reset].sort())!==JSON.stringify([...mutation.reset].sort()))throw Error('Unadmitted mutation reset');
      if(receipt.reset.length){committedResets.add({request,mutation,scope});await flushCommittedResets();}
     }
    }catch(cause){error(cause.message);}finally{action.busy=false;host.disabled=false;if(!context?.ids&&target.run)operationBusy(target.run,false);if(!disposed&&scope.active)render();}};
    host.addEventListener('click',click);scope.cleanups.add(()=>{host.removeEventListener('click',click);if(disposed)pending.delete(host);topActions.delete(action);actions.delete(host);});
   }
  }
  notifyObservers();void flushCommittedResets().catch(cause=>error(cause.message));
 }
 function flushCommittedResets(){
  const updates=[];
  for(const task of committedResets){const {request,mutation,scope}=task;
   if(disposed||plan.viewer&&viewerReady&&requestOwners.get(request)!==viewerId){committedResets.delete(task);continue;}
   if(plan.viewer&&!viewerReady||Object.values(tablePending).some(Boolean))continue;
   committedResets.delete(task);
   const live=()=>scope.completion.active||scope.completion.key&&completions.get(scope.completion.key)?.active;
   if(!live())continue;
   updates.push(client.updateQuery({query:doc(plan.localQuery)},data=>{if(disposed||!live()||plan.viewer&&(!viewerReady||requestOwners.get(request)!==viewerId))return data;const next={...data};for(const name of mutation.reset)if(Object.is(data[name],request.values[name]))next[name]=plan.defaults[name];return next;}));
  }
  return Promise.all(updates);
 }
 function refresh(){
  if(disposed)return;
  try{
   for(const query of plan.queries){const selected={};for(const field of query.values)selected[field.name]=own(values,field.name);const variables={...(query.values.length?{values:selected}:{}),only:[query.tableName]},signature=JSON.stringify(variables),prior=subscriptions.get(query.name);if(prior?.signature===signature)continue;
    if(prior){prior.active=false;prior.sub?.unsubscribe();}tables[query.name]=null;tableData[query.name]=null;tablePending[query.name]=true;tableErrors[query.name]=null;const item={signature,active:true,sub:null};subscriptions.set(query.name,item);
    item.sub=client.watchQuery({query:doc(query.document),variables,clearOnRefresh:true}).subscribe(result=>{if(disposed||!item.active)return;tablePending[query.name]=!!result.loading;try{if(at(result.data,[query.namespace])===null&&!result.errors?.length){tables[query.name]=null;tableData[query.name]=null;tableErrors[query.name]=result.loading?null:'Query unavailable';}else {tableErrors[query.name]=null;const decoded=decode(query,result);tables[query.name]=decoded.rows;tableData[query.name]=decoded;}render();}catch(cause){tables[query.name]=null;tableData[query.name]=null;tablePending[query.name]=false;tableErrors[query.name]='Query unavailable';render();error(cause.message);}});
   }
   render();
  }catch(cause){failed=true;stopQueries();error(cause.message);}
 }
 if(plan.localQuery)localSub=client.watchQuery({query:doc(plan.localQuery)}).subscribe(result=>{if(disposed)return;values=result.data;refresh();});else refresh();
 if(plan.viewer)viewerSub=client.watchQuery({query:doc(plan.viewer.document),clearOnRefresh:true}).subscribe(result=>{if(disposed)return;viewerReady=false;try{const identity=at(result.data,plan.viewer.responsePath.slice(0,-1)),id=at(result.data,plan.viewer.responsePath);if(result.errors?.length||!result.data||at(result.data,[plan.viewer.namespace])===null){render();return;}if(!identity||!Object.hasOwn(identity,'id')||id!==null&&(typeof id!=='string'||!id))throw Error('Invalid viewer identity');viewerId=id;viewerReady=true;render();}catch(cause){render();error(cause.message);}});
 const dispose=()=>{if(disposed)return;disposed=true;for(const listener of [...observers])listener({active:false,values:{},queries:{}});observers.clear();localSub?.unsubscribe();viewerSub?.unsubscribe();pending.clear();committedResets.clear();stopQueries();for(const scope of scopes)disposeScope(scope);};
 return Object.assign(dispose,{observe});
}`;
