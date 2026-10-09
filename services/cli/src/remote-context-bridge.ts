/** Memory-only context transport. Commands always execute in the caller's existing sandbox. */
import {createServer,createConnection,type Socket} from 'node:net';
import {mkdtemp,chmod,lstat,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname,isAbsolute,join} from 'node:path';
import {normalizeServer,type Connection} from './config';
import {CliError} from './errors';

interface RemoteBridgeContext {id:string;proof:string;home:string;server:string;connection?:Connection}
const LIMIT=16384,DEADLINE=2000;
const blocked=()=>new CliError('remote_context_blocked','The sandbox blocked managed agent context. Approve this exact command through your harness’s existing approval flow, then retry it.');
const denied=(error:unknown)=>['EPERM','EACCES'].includes((error as NodeJS.ErrnoException|undefined)?.code??'');
const unavailable=()=>new CliError('remote_context_unavailable','The managed agent context is unavailable. Restart this remote agent from its terminal.');
/** The entrypoint exposes only stable guidance, never IPC errors or credential values. */
export function remoteContextFailure(error:unknown):{code:string;message:string}{const issue=error instanceof CliError&&error.code==='remote_context_blocked'?blocked():unavailable();return {code:issue.code,message:issue.message};}
function validId(value:unknown):value is string{return typeof value==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(value);}
function context(value:unknown):RemoteBridgeContext{
 if(!value||typeof value!=='object'||Array.isArray(value))throw unavailable();
 const item=value as RemoteBridgeContext;
 if(Object.keys(item).some(key=>!['id','proof','home','server','connection'].includes(key))||!validId(item.id)||typeof item.proof!=='string'||!item.proof||item.proof.length>4096||typeof item.home!=='string'||!isAbsolute(item.home)||item.home.length>2048||typeof item.server!=='string'||item.server.length>2048)throw unavailable();
 try{if(normalizeServer(item.server)!==item.server)throw unavailable();}catch{throw unavailable();}
 if(item.connection!==undefined){
  const connection=item.connection;
  if(!connection||typeof connection!=='object'||Array.isArray(connection)||Object.keys(connection).some(key=>!['server','token','refreshToken','clientId','expiresAt'].includes(key))||connection.server!==item.server||typeof connection.token!=='string'||[connection.token,connection.refreshToken,connection.clientId].some(value=>value!==undefined&&(typeof value!=='string'||value.length>4096))||connection.expiresAt!==undefined&&(!Number.isSafeInteger(connection.expiresAt)||connection.expiresAt<=0))throw unavailable();
 }
 if(Buffer.byteLength(JSON.stringify(item))>LIMIT)throw unavailable();
 return {...item,...(item.connection?{connection:{...item.connection}}:{})};
}
export async function createRemoteContextBridge(input:RemoteBridgeContext):Promise<{path:string;close():Promise<void>}>{
 if(process.platform==='win32')throw unavailable(); // No same-user Windows ACL contract yet.
 const retained=context(input),directory=await mkdtemp(join(tmpdir(),'afb-')),path=join(directory,'ctx');
 const sockets=new Set<Socket>();let closed=false;
 const server=createServer(socket=>{
  if(closed||sockets.size>=32){socket.destroy();return;}sockets.add(socket);
  socket.setTimeout(DEADLINE,()=>socket.destroy());socket.on('error',()=>socket.destroy());socket.on('close',()=>sockets.delete(socket));
  let bytes=0,request='',answered=false;
  socket.on('data',chunk=>{
   if(answered)return;bytes+=chunk.length;if(bytes>1024){socket.destroy();return;}request+=chunk.toString('utf8');
   if(!request.includes('\n'))return;answered=true;
   try{const message=JSON.parse(request);if(Object.keys(message).length!==1||message.id!==retained.id)throw unavailable();socket.end(JSON.stringify(retained)+'\n');}
   catch{socket.end('{"error":"remote_context_unavailable"}\n');}
  });
 });
 server.on('error',()=>{for(const socket of sockets)socket.destroy();});
 try{
  await chmod(directory,0o700);
  await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(path,()=>{server.off('error',reject);resolve();});});
  await chmod(path,0o600);
 }catch{server.close();await rm(directory,{recursive:true,force:true});throw unavailable();}
 let closing:Promise<void>|undefined;
 return {path,close(){return closing??=Promise.resolve().then(async()=>{closed=true;for(const socket of sockets)socket.destroy();await new Promise<void>(resolve=>server.close(()=>resolve()));await rm(directory,{recursive:true,force:true});});}};
}
export async function readRemoteContextBridge(path:string,expectedId:string):Promise<RemoteBridgeContext>{
 if(process.platform==='win32'||!validId(expectedId)||!isAbsolute(path))throw unavailable();
 try{
  const [parent,file]=await Promise.all([lstat(dirname(path)),lstat(path)]),uid=process.getuid?.();
  if(uid===undefined||!parent.isDirectory()||!file.isSocket()||parent.uid!==uid||file.uid!==uid||(parent.mode&0o777)!==0o700||(file.mode&0o777)!==0o600)throw unavailable();
  return await new Promise<RemoteBridgeContext>((resolve,reject)=>{
   const socket=createConnection(path);const chunks:Buffer[]=[];let bytes=0,done=false;
   const timer=setTimeout(()=>finish(),DEADLINE);
   function finish(value?:RemoteBridgeContext,error?:unknown){if(done)return;done=true;clearTimeout(timer);socket.destroy();if(value)resolve(value);else reject(denied(error)?blocked():unavailable());}
   socket.on('error',error=>finish(undefined,error));socket.on('end',()=>finish());socket.on('connect',()=>socket.write(JSON.stringify({id:expectedId})+'\n'));
   socket.on('data',chunk=>{bytes+=chunk.length;if(bytes>LIMIT){finish();return;}chunks.push(chunk);const data=Buffer.concat(chunks).toString('utf8');if(!data.includes('\n'))return;try{const value=context(JSON.parse(data));if(value.id!==expectedId)throw unavailable();finish(value);}catch{finish();}});
  });
 }catch(error){if(denied(error)||(error instanceof CliError&&error.code==='remote_context_blocked'))throw blocked();throw unavailable();}
}
