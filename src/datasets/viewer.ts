import{DatasetReadError}from'./contracts.ts';
import type{DatasetViewerPorts,DatasetViewerService,DatasetViewerSnapshot}from'./viewer-contracts.ts';
function valid(value:DatasetViewerSnapshot,guest:boolean):boolean{
 return value!==null&&typeof value==='object'&&Object.keys(value).sort().join(',')==='generation,id'&&/^[a-f0-9]{64}$/.test(value.generation)&&(guest?value.id===null:typeof value.id==='string'&&value.id.length>0&&value.id.length<=256);
}
/** Two fresh observations bracket the read. An unavailable identity is never a guest. */
export function createDatasetViewerService(ports:DatasetViewerPorts):DatasetViewerService{
 return{async viewer(context,signal){
  signal?.throwIfAborted();const first=await ports.snapshot(context,signal);signal?.throwIfAborted();
  if(!first)throw new DatasetReadError('denied');
  if(!valid(first,context.subject===null))throw new DatasetReadError('invalid_dataset');
  const fresh=await ports.snapshot(context,signal);signal?.throwIfAborted();
  if(!fresh)throw new DatasetReadError('denied');
  if(!valid(fresh,context.subject===null))throw new DatasetReadError('invalid_dataset');
  if(first.generation!==fresh.generation||first.id!==fresh.id)throw new DatasetReadError('dataset_changed');
  return{generation:first.generation,id:first.id};
 }};
}
