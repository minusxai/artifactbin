/** Ordinary author JavaScript, embedded in the emitted module. No platform
 * runtime extension, source evaluation, network authority or shared-state cache. */
export const NATIVE_BINDINGS_RUNTIME = String.raw`function install(client,gql,document,plan,evaluate,normalizeTimestamp){
 let disposed=false,values={},tables={},localSub,failed=false;
 const subscriptions=new Map(),conditions=new WeakMap(),loops=new WeakMap(),actions=new WeakMap(),pending=new Map(),controls=new WeakMap();
 const rootScope={active:true,cleanups:new Set()},scopes=new Set([rootScope]);
 const disposeScope=scope=>{if(!scope.active)return;scope.active=false;for(const cleanup of scope.cleanups)cleanup();scope.cleanups.clear();scopes.delete(scope);};
 const own=(record,key)=>record&&Object.hasOwn(record,key)?record[key]??null:null;
 const at=(record,path)=>path.reduce((value,key)=>own(value,key),record);
 const doc=source=>gql([source]);
 const error=message=>{if(disposed)return;const notice=document.createElement('p');notice.setAttribute('role','alert');notice.textContent=message;document.body.append(notice);};
 const read=(expr,row)=>evaluate(expr,{values:{...values,...tables},row});
 const bindingId=node=>node.getAttribute?.('data-native-binding-id')||node.getAttribute?.('data-af-id');
 const all=root=>[...(bindingId(root)?[root]:[]),...(root.querySelectorAll?.('[data-af-id],[data-native-binding-id]')??[])];
 const lookup=(root,id)=>{const found=all(root).filter(node=>bindingId(node)===id);if(found.length>1)throw Error('Duplicate binding identity');return found[0];};
 const remap=(roots,context)=>{if(!context)return roots;const {ids,domIds,domBindings,durable}=context;
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
  return table.rows.map(row=>{if(!Array.isArray(row.cells)||row.cells.length!==table.columns.length)throw Error('Invalid registered row');const record=Object.create(null);row.cells.forEach((cell,index)=>{const column=table.columns[index],key=column.type==='number'?'number':column.type==='boolean'?'boolean':'text';if(!cell||typeof cell.isNull!=='boolean'||!cell.isNull&&(typeof cell[key]!==({number:'number',boolean:'boolean',text:'string'})[key]||typeof cell[key]==='number'&&!Number.isFinite(cell[key])))throw Error('Invalid registered cell');record[column.name]=cell.isNull?null:cell[key];});return record;});
 }
 function render(root=document,row,context,skip){
  const ids=context?.ids??{},scope=context?.scope??rootScope;
  if(disposed||failed||!scope.active)return;
  for(const target of plan.targets){if(target.sourceNode===skip)continue;const host=lookup(root,ids[target.afId]||target.afId);if(!host)continue;
   if(target.kind==='text'){const value=read(target.expression,row);host.textContent=typeof value==='string'||typeof value==='number'?String(value):'';}
   if(target.kind==='property'){
    const binding=target.writeback;let projection=read(target.expression,row);
    if(binding?.multiple){try{projection=projection===null?[]:JSON.parse(projection);if(!Array.isArray(projection))throw Error();}catch{error('Invalid multiple selection');projection=[];}}
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
     };host.addEventListener(binding.event,change);scope.cleanups.add(()=>host.removeEventListener(binding.event,change));
    }}
   }
   if(target.kind==='condition'){
    let branch=conditions.get(host);if(!branch){branch=clone(target.templateId,context);conditions.set(host,branch);}
    const yes=!!read(target.expression,row);if(yes){if(!host.childNodes.length)host.append(...branch);render(host,row,context,target.sourceNode);}else host.replaceChildren();
   }
   if(target.kind==='loop'){
    const rows=read(target.expression,row)??[],durable=target.identity.keyBy!==null;if(!Array.isArray(rows)||rows.length>10000)throw Error('Repeat source must be bounded rows');
    let state=loops.get(host);if(!state){state=new Map();loops.set(host,state);}const keys=new Set(),desired=[];
    for(const [index,entry]of rows.entries()){const key=durable?own(entry,target.identity.keyBy):index;if(!(typeof key==='number'&&Number.isFinite(key)||typeof key==='string'&&key.length<=256&&!/[\u0000-\u001f]/.test(key)))throw Error('Missing stable row key');const encoded=JSON.stringify([typeof key,key]);if(keys.has(encoded))throw Error('Duplicate stable row key');keys.add(encoded);desired.push({entry,key,encoded});}
    for(const [key,item]of state)if(!keys.has(key)){disposeScope(item.context.scope);item.host.remove();state.delete(key);}
    for(const {entry,key,encoded}of desired){let item=state.get(encoded);if(!item){const wrapper=document.createElement('span');wrapper.setAttribute('style','display:contents');const mapping={};for(const sourceId of target.identity.templateIds)mapping[sourceId]='mx-instance-'+encodeURIComponent(JSON.stringify([['repeat',target.identity.owner,durable?typeof key:'index',key],sourceId]));const domMapping={},domBindings={};for(const entry of target.identity.domIds||[]){domBindings[entry.domId]=entry.templateAfId;domMapping[entry.domId]='mx-instance-'+encodeURIComponent(JSON.stringify([['repeat',target.identity.owner,durable?typeof key:'index',key],entry.domId]));}const rowScope={active:true,cleanups:new Set()};scopes.add(rowScope);const rowContext={ids:mapping,domIds:domMapping,domBindings,durable,scope:rowScope};wrapper.append(...clone(target.templateId,rowContext));item={host:wrapper,context:rowContext};state.set(encoded,item);}host.append(item.host);render(item.host,entry,item.context);}

   }
   if(target.kind==='action'){
    const existing=actions.get(host);if(existing){existing.row=row;continue;}const action={row};actions.set(host,action);
    const click=async()=>{if(disposed||failed||!scope.active||host.disabled||action.busy)return;action.busy=true;host.disabled=true;try{
     if(target.set){const patch={};for(const [name,expr]of Object.entries(target.set)){const value=read(expr,action.row);if(!scalar(value)||!plan.valueTypes[name]||value!==null&&typeof value!==plan.valueTypes[name])throw Error('Invalid local action value');patch[name]=value;}await client.updateQuery({query:doc(plan.localQuery)},data=>disposed||!scope.active?data:({...data,...patch}));}
     if(disposed||!scope.active)return;
     if(target.run){const mutation=plan.mutations.find(item=>item.name===target.run);let request=pending.get(host);if(!request){const snapshot={};for(const field of mutation.values)snapshot[field.name]=own(values,field.name);request={requestId:crypto.randomUUID(),values:snapshot};pending.set(host,request);}const result=await client.mutate({mutation:doc(mutation.document),variables:request});if(disposed||!scope.active)return;
      if(result.errors?.length)throw Error('Mutation failed; local values were retained');const receipt=at(result.data,mutation.outcomePath);if(!receipt||receipt.requestId!==request.requestId||!['committed','rejected','unknown'].includes(receipt.outcome))throw Error('Mutation outcome unavailable; local values were retained');
      if(receipt.outcome==='unknown')throw Error('Mutation outcome unknown; retry keeps the original request');pending.delete(host);
      if(receipt.outcome==='rejected')throw Error('Mutation rejected; local values were retained');
      if(!Array.isArray(receipt.reset)||JSON.stringify([...receipt.reset].sort())!==JSON.stringify([...mutation.reset].sort()))throw Error('Unadmitted mutation reset');
      if(receipt.reset.length)await client.updateQuery({query:doc(plan.localQuery)},data=>{if(disposed||!scope.active)return data;const next={...data};for(const name of receipt.reset)if(Object.is(data[name],request.values[name]))next[name]=plan.defaults[name];return next;});
     }
    }catch(cause){error(cause.message);}finally{action.busy=false;host.disabled=false;if(!disposed&&scope.active)render();}};
    host.addEventListener('click',click);scope.cleanups.add(()=>{host.removeEventListener('click',click);pending.delete(host);});
   }
  }
 }
 function refresh(){
  if(disposed)return;
  try{
   for(const query of plan.queries){const selected={};for(const field of query.values)selected[field.name]=own(values,field.name);const variables={...(query.values.length?{values:selected}:{}),only:[query.tableName]},signature=JSON.stringify(variables),prior=subscriptions.get(query.name);if(prior?.signature===signature)continue;
    if(prior){prior.active=false;prior.sub?.unsubscribe();}tables[query.name]=null;const item={signature,active:true,sub:null};subscriptions.set(query.name,item);
    item.sub=client.watchQuery({query:doc(query.document),variables,clearOnRefresh:true}).subscribe(result=>{if(disposed||!item.active)return;try{if(at(result.data,[query.namespace])===null&&!result.errors?.length){tables[query.name]=null;}else tables[query.name]=decode(query,result);render();}catch(cause){tables[query.name]=null;render();error(cause.message);}});
   }
   render();
  }catch(cause){failed=true;stopQueries();error(cause.message);}
 }
 if(plan.localQuery)localSub=client.watchQuery({query:doc(plan.localQuery)}).subscribe(result=>{if(disposed)return;values=result.data;refresh();});else refresh();
 return ()=>{if(disposed)return;disposed=true;localSub?.unsubscribe();stopQueries();for(const scope of scopes)disposeScope(scope);};
}`;
