const error=code=>Object.assign(new Error(`Connector ${code.toLowerCase()}`),{code,outcome:'unknown'});
export function validateJson(value,maxBytes=65536){
 const seen=new Set();
 function walk(v,depth=0){
  if(depth>32)throw error('INVALID');
  if(v===null||typeof v==='string'||typeof v==='boolean')return;
  if(typeof v==='number'&&Number.isFinite(v))return;
  if(typeof v!=='object'||seen.has(v))throw error('INVALID');
  const proto=Object.getPrototypeOf(v);
  if(proto!==Object.prototype&&proto!==Array.prototype&&proto!==null)throw error('INVALID');
  if(Array.isArray(v)){
   if(Object.keys(v).length!==v.length)throw error('INVALID');
   for(let i=0;i<v.length;i++)if(!Object.hasOwn(v,i))throw error('INVALID');
  }
  seen.add(v);
  for(const key of Reflect.ownKeys(v)){
   if(Array.isArray(v)&&key==='length')continue;
   const descriptor=Object.getOwnPropertyDescriptor(v,key);
   if(typeof key!=='string'||!descriptor.enumerable||!('value' in descriptor))throw error('INVALID');
   walk(descriptor.value,depth+1);
  }
  seen.delete(v);
 }
 walk(value);if(Buffer.byteLength(JSON.stringify(value))>maxBytes)throw error('INVALID');return value;
}
export function createConnectorHost(config,{timeoutMs=1000,maxBytes=65536,maxActive=16}={}){
 if(!Number.isInteger(maxActive)||maxActive<1||!Number.isFinite(timeoutMs)||timeoutMs<1)throw error('INVALID');
 const bindings=Object.fromEntries(Object.entries(config).map(([key,b])=>[key,Object.freeze({...b,operations:Object.freeze(Object.fromEntries(Object.entries(b.operations).map(([name,op])=>[name,Object.freeze({...op})])))})]));
 let closed=false,pendingAcquires=0;const active=new Set();
 const snapshot=value=>JSON.parse(JSON.stringify(validateJson(value,maxBytes)));
 function authorize(caller,resource,operation){
  if(closed)throw error('CLOSED');
  if(!caller||typeof caller.userId!=='string'||!caller.userId||typeof caller.tenantId!=='string'||!caller.tenantId||!Array.isArray(caller.grants)||!caller.grants.includes(resource)||!Object.hasOwn(bindings,resource))throw error('DENIED');
  const binding=bindings[resource];if(!Object.hasOwn(binding.operations,operation))throw error('DENIED');
  return {binding,op:binding.operations[operation]};
 }
 async function scope(signal,fn){
  if(active.size>=maxActive)throw error('UNAVAILABLE');
  const stop=new AbortController();active.add(stop);
  const abort=()=>stop.abort(error('CANCELLED'));
  if(signal?.aborted)abort();else signal?.addEventListener('abort',abort,{once:true});
  const timer=setTimeout(()=>stop.abort(error('TIMEOUT')),timeoutMs);
  try{stop.signal.throwIfAborted();return await fn(stop.signal);}
  catch(e){if(stop.signal.aborted)throw stop.signal.reason;if(['DENIED','INVALID','CLOSED','TIMEOUT'].includes(e.code))throw e;throw error(e.code==='23505'?'CONFLICT':'UNAVAILABLE');}
  finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);active.delete(stop);}
 }
 async function postgres(binding,caller,operations,signal){
  let client,released=false;
  const release=destroy=>{if(client&&!released){released=true;client.release(destroy);}};
  let rejectStop;const stopped=new Promise((_,reject)=>{rejectStop=reject;});
  const abort=()=>{release(true);rejectStop(signal.reason);};
  signal.addEventListener('abort',abort,{once:true});
  try{
   if(pendingAcquires>=maxActive)throw error('UNAVAILABLE');
   pendingAcquires++;
   const acquire=binding.pool.connect().then(c=>{client=c;if(signal.aborted){release(true);throw signal.reason;}return c;}).finally(()=>{pendingAcquires--;});
   await Promise.race([acquire,stopped]);
   const query=(text,values)=>Promise.race([client.query(text,values),stopped]);
   await query('BEGIN');
   // Server timeout bounds work even if the host process disappears during a query.
   await query("SELECT set_config('statement_timeout',$1,true)",[String(timeoutMs)]);
   const results=[];
   for(const {operation,input} of operations){
    const op=binding.operations[operation];const params=op.params(caller,input);validateJson(params,maxBytes);
    const result=await query(op.text,params);results.push(validateJson(result.rows,maxBytes));
   }
   await query('COMMIT');return results;
  }catch(e){if(client&&!released){try{await client.query('ROLLBACK');}catch{release(true);}}if(e.code==='57014')throw error('TIMEOUT');throw e;}
  finally{signal.removeEventListener('abort',abort);release(false);}
 }
 async function http(binding,op,caller,input,signal){
  const origin=new URL(binding.origin);const url=new URL(op.path,origin);
  if(url.origin!==origin.origin||url.username||url.password||!['https:','http:'].includes(url.protocol))throw error('DENIED');
  const response=await fetch(url,{method:op.method,redirect:'error',signal,headers:{'content-type':'application/json',authorization:`Bearer ${binding.token}`},body:JSON.stringify({caller:{userId:caller.userId,tenantId:caller.tenantId},input})});
  if(!response.ok){await response.body?.cancel();throw error('UNAVAILABLE');}
  const reader=response.body.getReader();let length=0;const chunks=[];
  try{for(;;){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>maxBytes)throw error('INVALID');chunks.push(value);}}
  finally{await reader.cancel();}
  let result;try{result=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw error('INVALID');}return validateJson(result,maxBytes);
 }
 return {
  async invoke(caller,{resource,operation,input},signal){
   caller=snapshot(caller);input=snapshot(input);const {binding,op}=authorize(caller,resource,operation);
   return scope(signal,s=>binding.kind==='postgres'?postgres(binding,caller,[{operation,input}],s).then(r=>r[0]):http(binding,op,caller,input,s));
  },
  async transaction(caller,resource,operations,signal){
   caller=snapshot(caller);operations=snapshot(operations);
   if(!Array.isArray(operations)||!operations.length||operations.length>100)throw error('INVALID');
   const {binding}=authorize(caller,resource,operations[0].operation);if(binding.kind!=='postgres')throw error('INVALID');
   for(const op of operations){authorize(caller,resource,op.operation);validateJson(op.input,maxBytes);}
   return scope(signal,s=>postgres(binding,caller,operations,s));
  },
  async close(){if(closed)return;closed=true;for(const controller of active)controller.abort(error('CANCELLED'));await Promise.all([...new Set(Object.values(bindings).filter(b=>b.kind==='postgres').map(b=>b.pool))].map(p=>p.end()));}
 };
}
