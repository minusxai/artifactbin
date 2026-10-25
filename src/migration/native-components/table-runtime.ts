/** A completion belongs to an exact table/typed row/column, independently of DOM mounting. */
export interface NativeTableCellCompletionIdentity {owner:string;rowKey:string|number;column:string}
export interface NativeTableCellCompletionPort<Scope> {cellScope(parent:Scope,identity:NativeTableCellCompletionIdentity):Scope}
/** Caller-owned native cell renderers. Cached nodes retain unresolved action identity
 * through virtualisation; only their active subscriptions/listeners are scoped. */
export const NATIVE_TABLE_RUNTIME = String.raw`function createTable(host,target,ports){
 const cells=new Map();let parent,observer;
 const deactivate=()=>{observer?.disconnect();observer=null;for(const item of cells.values()){if(item.scope)ports.disposeScope(item.scope);item.scope=null;}parent=null;};
 const renderers=Object.create(null);
 for(const column of target.columns)if(column.template)renderers[column.spec.col]=(cell,existing)=>{
  if(!parent?.active)return;
  const key=cell.key;if(!(typeof key==='string'&&key.length<=256&&!/[\u0000-\u001f]/.test(key)||typeof key==='number'&&Number.isFinite(key)))throw Error('Missing stable table row key');
  const encoded=JSON.stringify([typeof key,key,column.spec.col]);let item=cells.get(encoded);
  if(!item){
   const scopeKey=['table',target.owner,typeof key,key,column.spec.col],ids={},domIds={},domBindings={};
   for(const id of column.template.templateIds)ids[id]='mx-instance-'+encodeURIComponent(JSON.stringify([scopeKey,id]));
   for(const entry of column.template.domIds){domBindings[entry.domId]=entry.templateAfId;domIds[entry.domId]='mx-instance-'+encodeURIComponent(JSON.stringify([scopeKey,entry.domId]));}
   const wrapper=host.ownerDocument.createElement('span');wrapper.style.display='contents';
   item={wrapper,context:{ids,domIds,domBindings,durable:true},scope:null};wrapper.append(...ports.clone(column.template.templateId,item.context));cells.set(encoded,item);
  }
  if(!item.scope?.active)item.scope=ports.cellScope(parent,{owner:target.owner,rowKey:key,column:column.spec.col});
  ports.render(item.wrapper,cell.row,{...item.context,scope:item.scope});
  if(existing.firstChild!==item.wrapper)existing.replaceChildren(item.wrapper);
 };
 return {update(data,scope){
  if(parent!==scope){deactivate();parent=scope;scope.cleanups.add(deactivate);
   const Observer=host.ownerDocument.defaultView?.MutationObserver;
   if(Observer){observer=new Observer(()=>{for(const item of cells.values())if(item.scope&&!host.contains(item.wrapper)){ports.disposeScope(item.scope);item.scope=null;}});observer.observe(host,{childList:true,subtree:true});}
   host.columnIdentities=Object.fromEntries(target.columns.map(column=>[column.spec.col,{afId:column.afId,...(column.domId?{id:column.domId}:{})}]));
   host.columns=target.columns.map(column=>column.spec);host.rowKey=target.rowKey;host.cellRenderers=renderers;
  }
  host.data=data;
 }};
}`;
