/** Exercise the pinned driver against PostgreSQL wire messages: a CancelRequest acknowledgement
 * alone never releases the original session. The real-engine suite separately verifies backend work stops. */
import net from 'node:net';
import { expect, it } from 'vitest';
import { openConnection } from '@artifactbin/connectors';
import { startPgliteWire } from '@artifactbin/test-support/pglite-wire';

const latch=()=>{let resolve!:()=>void;const promise=new Promise<void>(r=>{resolve=r;});return {promise,resolve};};
const frame=(type:string,body:Buffer)=>{const header=Buffer.alloc(5);header[0]=type.charCodeAt(0);header.writeInt32BE(body.length+4,1);return Buffer.concat([header,body]);};

it('sends the exact native cancellation key and waits for original server completion before releasing capacity',async()=>{
 const database=await startPgliteWire('select 1');
 const executing=latch(),cancelled=latch(),sockets=new Set<net.Socket>();
 let held:net.Socket|undefined,key:Buffer|undefined,cancelKey:Buffer|undefined;
 const sqlTexts:string[]=[];
 const proxy=net.createServer(client=>{
  sockets.add(client);client.on('error',()=>{});client.on('close',()=>sockets.delete(client));
  let pending=Buffer.alloc(0),started=false,holding=false,query='',server:net.Socket|undefined,reply=Buffer.alloc(0);
  client.on('data',chunk=>{
   pending=Buffer.concat([pending,chunk]);
   for(;;){
    if(!started){
     if(pending.length<4)return;
     const length=pending.readInt32BE(0);if(pending.length<length)return;
     const startup=pending.subarray(0,length);pending=pending.subarray(length);
     if(length===16&&startup.readInt32BE(4)===80877102){
      cancelKey=Buffer.from(startup.subarray(8));cancelled.resolve();client.end();return;
     }
     started=true;
     server=net.connect({host:'127.0.0.1',port:database.port},()=>server!.write(startup));
     sockets.add(server);server.on('error',()=>client.destroy());server.on('close',()=>{sockets.delete(server!);client.end();});
     client.on('close',()=>server?.destroy());
     server.on('data',data=>{
      reply=Buffer.concat([reply,data]);
      while(reply.length>=5){
       const size=reply.readInt32BE(1)+1;if(reply.length<size)return;
       const packet=reply.subarray(0,size);reply=reply.subarray(size);
       if(packet[0]===75)key=Buffer.from(packet.subarray(5));
       client.write(packet);
      }
     });
     continue;
    }
    if(pending.length<5)return;
    const length=pending.readInt32BE(1)+1;if(pending.length<length)return;
    const packet=pending.subarray(0,length);pending=pending.subarray(length);
    const type=String.fromCharCode(packet[0]!);
    if(type==='P'||type==='Q'){
     query=packet.subarray(5).toString().split('\0')[type==='P'?1:0]!;sqlTexts.push(query);
    }
    if(type==='E'&&query.includes('cancellation_probe')){holding=true;held=client;executing.resolve();}
    if(!holding||type==='X')server!.write(packet);
   }
  });
 });
 await new Promise<void>(r=>proxy.listen(0,'127.0.0.1',r));
 const connection=openConnection({connector:'postgres',host:'127.0.0.1',port:(proxy.address() as net.AddressInfo).port,database:'postgres',user:'reader',tls:'disable'},{allowPrivateNetwork:true});
 const abort=new AbortController();
 let completed=false;
 const work=connection.query({text:'select 99 as cancellation_probe',params:{},viewer:{id:'u_reader',email:'reader@example.com',groups:[]},signal:abort.signal})
  .then(value=>({value}),error=>({error})).finally(()=>{completed=true;});
 try{
  await executing.promise;abort.abort();await cancelled.promise;
  expect(cancelKey).toEqual(key);expect(cancelKey?.length).toBe(8);
  await new Promise(r=>setTimeout(r,20));
  expect(completed).toBe(false);expect(connection.sessions()).toBe(1);
  const error=Buffer.from('SERROR\0VERROR\0C57014\0Mcanceling statement due to user request\0\0');
  held!.write(Buffer.concat([frame('E',error),frame('Z',Buffer.from('E'))]));
  expect(await work).toMatchObject({error:{code:'timeout'}});
  expect(connection.sessions()).toBe(0);
  expect(sqlTexts.join('\n')).not.toMatch(/pg_backend_pid|pg_stat_activity|pg_terminate_backend/);
  expect((await connection.query({text:'select 1 as n',params:{},viewer:null})).rows).toEqual([{n:1}]);
 }finally{
  for(const socket of sockets)socket.destroy();
  await work;await connection.close();
  await new Promise<void>(r=>proxy.close(()=>r()));await database.close();
 }
},10000);
