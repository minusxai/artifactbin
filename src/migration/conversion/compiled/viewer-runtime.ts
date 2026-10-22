import type{CompiledViewerOptions,CompiledViewerAdapter,CompiledViewerSnapshot}from'./viewer-contracts.ts';
function receipt(value:unknown):CompiledViewerSnapshot|null{
 if(!value||typeof value!=='object'||Array.isArray(value))return null;const s=value as CompiledViewerSnapshot;
 return Object.keys(s).sort().join(',')==='generation,id'&&typeof s.generation==='string'&&/^[a-f0-9]{64}$/.test(s.generation)&&(s.id===null||typeof s.id==='string'&&s.id.length>0&&s.id.length<=256)?{generation:s.generation,id:s.id}:null;
}
/** No retained viewer identity is authority. Every invalidation gates before clearing. */
export function createCompiledViewer(options:CompiledViewerOptions):CompiledViewerAdapter{
 let epoch=0,disposed=false,running=false,controller:AbortController|undefined,pending:CompiledViewerSnapshot|null=null;
 const invalidate=(state:'pending'|'unavailable')=>{epoch++;pending=null;controller?.abort();controller=undefined;options.gate(state);options.clear();};
 const pump=()=>{
  if(disposed||running||!pending)return;
  const next=pending;pending=null;running=true;const ticket=epoch,active=controller=new AbortController();
  void Promise.resolve().then(()=>{if(disposed||ticket!==epoch)throw Error('Viewer changed');return options.apply(next,active.signal);}).then(()=>{if(!disposed&&ticket===epoch&&!active.signal.aborted)options.gate('ready');},()=>{if(!disposed&&ticket===epoch)invalidate('unavailable');}).finally(()=>{running=false;pump();});
 };
 invalidate('pending');
 const stop=options.watch(value=>{
  if(disposed)return;
  const next=receipt(value);invalidate(value===undefined||next?'pending':'unavailable');if(!next)return;
  pending=next;pump();
 });
 return{dispose(){if(disposed)return;disposed=true;invalidate('unavailable');stop();}};
}
