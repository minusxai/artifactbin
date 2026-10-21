import { limits } from './contracts.ts';
import type { CommitResult, Json, Operation, Principal, Receipt, Rejection, Replica, Server, Snapshot } from './contracts.ts';
const copy=<T>(v:T):T=>structuredClone(v);
const own=(v:object,k:string)=>Object.prototype.hasOwnProperty.call(v,k);
const safe=(k:unknown):k is string=>typeof k==='string'&&/^[a-zA-Z0-9_-]{1,128}$/.test(k)&&!['__proto__','prototype','constructor'].includes(k);
function canonical(v:unknown, seen=new Set<object>(), depth=0):string {
 if(depth>64)throw Error('invalid JSON depth');
 if(v===null||typeof v==='boolean'||typeof v==='string')return JSON.stringify(v);
 if(typeof v==='number'&&Number.isFinite(v))return JSON.stringify(v);
 if(typeof v!=='object'||!v||seen.has(v))throw Error('invalid JSON');
 const array=Array.isArray(v);
 if(!array&&Object.getPrototypeOf(v)!==Object.prototype&&Object.getPrototypeOf(v)!==null)throw Error('invalid JSON');
 const descriptors=Object.getOwnPropertyDescriptors(v);
 for(const key of Reflect.ownKeys(descriptors)){
  if(typeof key!=='string')throw Error('invalid JSON symbol');
  if(array&&key==='length')continue;
  const d=descriptors[key];if(!d.enumerable||!('value' in d))throw Error('invalid JSON descriptor');
 }
 if(array&&(Object.keys(v).length!==v.length||!Array.from({length:v.length},(_,i)=>Object.hasOwn(v,String(i))).every(Boolean)))throw Error('invalid JSON array');
 seen.add(v);
 const result=array?'['+Array.from({length:v.length},(_,i)=>canonical(descriptors[String(i)].value,seen,depth+1)).join(',')+']':'{'+Object.keys(descriptors).sort().map(k=>JSON.stringify(k)+':'+canonical(descriptors[k].value,seen,depth+1)).join(',')+'}';
 seen.delete(v);return result;
}
export function binding(op:Operation):string { return canonical(op); }
function valid(op:Operation):boolean {
 try{return safe(op.id)&&safe(op.key)&&Number.isSafeInteger(op.epoch)&&op.epoch>=1&&Number.isSafeInteger(op.baseVersion)&&op.baseVersion>=0&&Number.isFinite(op.expiresAt)&&new TextEncoder().encode(binding(op)).byteLength<=limits.bytes;}catch{return false;}
}
export function createServer():Server{return {epoch:1,version:0,data:{},receipts:{},effects:[]};}
export function applyOperation(server:Server,op:Operation,principal:Principal,now:number):CommitResult {
 if(!Number.isFinite(now))throw Error('invalid clock');
 let serialized='';try{serialized=binding(op);}catch{return {server:copy(server),receipt:{id:'',binding:'',status:'rejected',reason:'invalid',version:server.version}};}
 const reject=(reason:Rejection):CommitResult=>({server:copy(server),receipt:{id:op.id,binding:serialized,status:'rejected',reason,version:server.version}});
 if(op.epoch!==server.epoch)return reject('epoch');
 if(!valid(op))return reject('invalid');
 if(own(server.receipts,op.id)){const prior=server.receipts[op.id];return prior.binding===serialized?{server:copy(server),receipt:copy(prior)}:reject('id-reused');}
 if(Object.keys(server.receipts).length>=limits.receipts||server.effects.length>=limits.effects)return reject('capacity');
 const reason:Rejection|undefined=op.schema!==1?'schema':!principal.canWrite?'forbidden':now>=op.expiresAt?'expired':op.baseVersion!==server.version?'conflict':undefined;
 const next=copy(server);
 if(!reason){next.data[op.key]=copy(op.value);next.version++;next.effects.push({id:op.id,epoch:op.epoch,version:next.version});}
 const receipt:Receipt={id:op.id,binding:serialized,status:reason?'rejected':'accepted',...(reason?{reason}:{}),version:next.version}; next.receipts[op.id]=receipt;
 return {server:next,receipt:copy(receipt)};
}
export function createReplica(snapshot:Snapshot):Replica{return {confirmed:snapshotOnly(snapshot),pending:[],dispatched:[],receipts:[]};}
function snapshotOnly(s:Snapshot):Snapshot{return copy({epoch:s.epoch,version:s.version,data:s.data});}
export function enqueue(replica:Replica,operation:Operation):Replica {
 if(!valid(operation)||operation.schema!==1||operation.epoch!==replica.confirmed.epoch)throw Error('invalid operation');
 if(replica.pending.length>=limits.pending)throw Error('pending capacity');
 if(replica.pending.some(x=>x.id===operation.id)||replica.receipts.some(x=>x.id===operation.id))throw Error('duplicate operation ID');
 return {...copy(replica),pending:[...copy(replica.pending),copy(operation)]};
}
/** Optimism is a disposable projection, never the authoritative version. */
export function optimistic(replica:Replica):Snapshot {const s=snapshotOnly(replica.confirmed);for(const op of replica.pending)s.data[op.key]=copy(op.value);return s;}
/** Only remove unsent work; a transport must not claim cancellation once delivery may have begun. */
export function markDispatched(replica:Replica,id:string):Replica {if(!replica.pending.some(o=>o.id===id))throw Error('unknown operation');return {...copy(replica),dispatched:[...new Set([...replica.dispatched,id])]};}
export function cancelPending(replica:Replica,id:string):Replica{if(replica.dispatched.includes(id))throw Error('delivery outcome unknown; reconcile first');return {...copy(replica),pending:replica.pending.filter(x=>x.id!==id).map(copy)};}
export function reconcile(replica:Replica,snapshot:Snapshot,receipts:Receipt[]):Replica {
 if(!Number.isSafeInteger(snapshot.epoch)||snapshot.epoch<1||!Number.isSafeInteger(snapshot.version)||snapshot.version<0||!snapshot.data||Array.isArray(snapshot.data)||typeof snapshot.data!=='object')throw Error('invalid snapshot');
 canonical(snapshot.data);
 if(snapshot.epoch<replica.confirmed.epoch||(snapshot.epoch===replica.confirmed.epoch&&snapshot.version<replica.confirmed.version))throw Error('stale snapshot');
 const reasons=['conflict','forbidden','expired','epoch','schema','invalid','capacity','id-reused'];
 const acknowledged=new Map(receipts.filter(r=>safe(r.id)&&typeof r.binding==='string'&&Number.isSafeInteger(r.version)&&r.version>=0&&r.version<=snapshot.version&&((r.status==='accepted'&&r.reason===undefined)||(r.status==='rejected'&&reasons.includes(r.reason!)))).map(r=>[r.id,r])); const kept:Operation[]=[]; const settled=[...copy(replica.receipts)];
 for(const op of replica.pending){
  if(op.epoch!==snapshot.epoch){settled.push({id:op.id,binding:binding(op),status:'rejected',reason:'epoch',version:snapshot.version});continue;}
  const r=acknowledged.get(op.id);if(r&&r.binding===binding(op)){settled.push(copy(r));}else kept.push(copy(op));
 }
 return {confirmed:snapshotOnly(snapshot),pending:kept,dispatched:replica.dispatched.filter(id=>kept.some(o=>o.id===id)),receipts:settled.slice(-limits.receipts)};
}
/** Explicit administrative checkpoint: drain/fence clients before dropping old receipt history. */
export function rotateEpoch(server:Server):Server{return {...copy(server),epoch:server.epoch+1,receipts:{}};}
