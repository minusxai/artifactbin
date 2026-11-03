/**
 * The resolver database tunnel's controller half (services/runner database-tunnel.ts) against real local TCP
 * servers: which targets it connects to, every limit, backpressure both ways and cleanup. DNS and the connect
 * call are injected where a case needs answers no test machine has (a public name resolving to a private
 * address, a connection that never completes); everything else is a real socket.
 */
import net from 'node:net';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {RESOLVER_DATABASE_LIMITS,type RunnerJson} from '@artifactbin/contracts';
import {createDatabaseTunnels,type DatabaseTunnelOptions,type TunnelScope} from '@artifactbin/runner/database-tunnel';

type Sent={type:string;tunnel?:number;error?:string;data?:string;bytes?:number};
const cleanup:Array<()=>unknown>=[];
afterEach(async()=>{for(const close of cleanup.splice(0).reverse())await close();});
const until=async(check:()=>boolean,ms=3000)=>{const end=Date.now()+ms;while(!check()){if(Date.now()>end)throw Error('timed out');await new Promise(r=>setTimeout(r,5));}};

/** A loopback server that records each connection and when it closed. */
async function server(onSocket:(socket:net.Socket)=>void=()=>{}){
 const sockets:net.Socket[]=[],closed:net.Socket[]=[],received:Buffer[]=[];
 const s=net.createServer(socket=>{sockets.push(socket);socket.on('error',()=>{});socket.on('close',()=>closed.push(socket));socket.on('data',b=>received.push(b));onSocket(socket);});
 await new Promise<void>(r=>s.listen(0,'127.0.0.1',()=>r()));
 cleanup.push(()=>new Promise<void>(r=>{for(const socket of sockets)socket.destroy();s.close(()=>r());}));
 return {port:(s.address() as net.AddressInfo).port,sockets,closed,received:()=>Buffer.concat(received)};
}
function harness(options:DatabaseTunnelOptions={allowLoopback:true},scope:TunnelScope={owner:'owner1',page:'page1'}){
 const tunnels=createDatabaseTunnels(options);
 const run=(s:TunnelScope=scope)=>{
  const sent:Sent[]=[];const r=tunnels.forRun(s,m=>sent.push(m as Sent));cleanup.push(()=>r.close());
  const closedWith=async(tunnel:number)=>{await until(()=>sent.some(m=>m.type==='tunnel_closed'&&m.tunnel===tunnel));return sent.find(m=>m.type==='tunnel_closed'&&m.tunnel===tunnel)!.error;};
  const opened=(tunnel:number)=>until(()=>sent.some(m=>m.type==='tunnel_opened'&&m.tunnel===tunnel));
  const received=(tunnel:number)=>Buffer.concat(sent.filter(m=>m.type==='tunnel_data'&&m.tunnel===tunnel).map(m=>Buffer.from(m.data!,'base64')));
  return {...r,sent,closedWith,opened,received};
 };
 return {tunnels,run};
}
const target=(port:number,host='127.0.0.1',extra:Record<string,RunnerJson>={}):RunnerJson=>({host,port,database:'d',user:'u',password:'pw',tls:'disable',...extra});
const grantOf=(value:RunnerJson)=>(value as {grant:string}).grant;
const b64=(n:number,fill=0x61)=>Buffer.alloc(n,fill).toString('base64');

describe('what a grant may name',()=>{
 it('refuses ports below 1024, non-ports, plaintext without the development opt-in and odd host spellings',()=>{
  const strict=createDatabaseTunnels().forRun({owner:'o',page:'p'},()=>{});
  const loose=createDatabaseTunnels({allowLoopback:true}).forRun({owner:'o',page:'p'},()=>{});
  for(const port of [1,22,25,80,443,1023])expect(()=>loose.grant(target(port))).toThrow(/^port_forbidden/);
  for(const port of [0,65536,5432.5,'5432',null,-1])expect(()=>loose.grant(target(port as number))).toThrow('invalid_connection');
  expect(()=>strict.grant({host:'db.example.com',port:5432,tls:'disable'})).toThrow('tls_required');
  for(const tls of [undefined,'require','prefer',true])expect(()=>strict.grant({host:'db.example.com',port:5432,...(tls===undefined?{}:{tls})} as RunnerJson)).toThrow('invalid_connection');
  for(const host of ['2130706433','0x7f.1','127.1','0x7f000001','1.0x7f','010.0.0.1','postgres','db.example.com:5432','https://db.example.com',''])
   expect(()=>loose.grant(target(5432,host)),host).toThrow('invalid_connection');
  expect(grantOf(strict.grant({host:'DB.Example.com',port:5432,tls:'verify-full'}))).toMatch(/^g\d+$/);
  expect(strict.grant({host:'DB.Example.com',port:6543,tls:'verify-full',password:'pw'})).toMatchObject({host:'db.example.com',port:6543,password:'pw',grant:expect.any(String)});
 });
 it('refuses a literal address outside public space at grant time, every class and encoding',()=>{
  const strict=createDatabaseTunnels().forRun({owner:'o',page:'p'},()=>{});
  const loopbackOnly=createDatabaseTunnels({allowLoopback:true}).forRun({owner:'o',page:'p'},()=>{});
  const blocked=['127.0.0.1','10.0.0.1','172.16.0.1','192.168.1.1','169.254.169.254','100.64.0.1','0.0.0.0','224.0.0.1','240.0.0.1','255.255.255.255','198.18.0.1',
   '::1','[::1]','fc00::1','fd00::1','fe80::1','::ffff:127.0.0.1','::ffff:7f00:1','::ffff:169.254.169.254','::127.0.0.1','64:ff9b::a9fe:a9fe','2002:7f00:1::1','2001:db8::1','ff02::1','::'];
  for(const host of blocked)expect(()=>strict.grant({host,port:5432,tls:'verify-full'}),host).toThrow('forbidden_address');
  // The opt-in admits loopback only: never metadata, RFC1918 or the rest.
  for(const host of blocked.filter(h=>!['127.0.0.1','::1','[::1]','::ffff:127.0.0.1','::ffff:7f00:1'].includes(h)))expect(()=>loopbackOnly.grant({host,port:5432,tls:'verify-full'}),host).toThrow('forbidden_address');
  for(const host of ['127.0.0.1','::1','::ffff:7f00:1'])expect(()=>loopbackOnly.grant({host,port:5432,tls:'verify-full'}),host).not.toThrow();
  for(const host of ['8.8.8.8','2606:4700:4700::1111','::ffff:8.8.8.8'])expect(()=>strict.grant({host,port:5432,tls:'verify-full'}),host).not.toThrow();
 });
});

describe('DNS: one lookup, every answer judged, the judged address connected',()=>{
 const privateAnswers:Record<string,string[]>={
  loopback:['127.0.0.1'],loopback6:['::1'],rfc1918:['10.1.2.3'],rfc1918b:['172.20.0.5'],rfc1918c:['192.168.0.10'],metadata:['169.254.169.254'],cgnat:['100.100.100.100'],
  thisNetwork:['0.0.0.0'],multicast:['239.1.1.1'],reserved:['240.1.1.1'],ula:['fd00::5'],linkLocal6:['fe80::1'],mapped:['::ffff:10.0.0.1'],mappedHex:['::ffff:a9fe:a9fe'],
  compatible:['::10.0.0.1'],nat64:['64:ff9b::a00:1'],sixToFour:['2002:a00:1::1'],
  mixed:['8.8.8.8','10.0.0.1'],mixedLast:['2606:4700:4700::1111','8.8.4.4','::1'],unparseable:['not-an-address'],
 };
 for(const [kind,answers] of Object.entries(privateAnswers))
  it(`refuses a name that resolves to ${kind} (${answers.join(', ')}) without connecting`,async()=>{
   const connect=vi.fn(),lookup=vi.fn(async()=>answers.map(address=>({address,family:address.includes(':')?6:4})));
   const r=harness({lookup,connect:connect as never}).run();
   r.message({type:'tunnel_open',tunnel:1,grant:grantOf(r.grant({host:'db.example.com',port:5432,tls:'verify-full'}))});
   expect(await r.closedWith(1)).toBe('forbidden_address');
   expect(lookup).toHaveBeenCalledTimes(1);expect(connect).not.toHaveBeenCalled();
  });
 it('the loopback opt-in still refuses a name answering a private or metadata address, alone or mixed with loopback',async()=>{
  for(const answers of [['10.0.0.1'],['127.0.0.1','169.254.169.254']]){
   const connect=vi.fn();const r=harness({allowLoopback:true,lookup:async()=>answers.map(address=>({address,family:4})),connect:connect as never}).run();
   r.message({type:'tunnel_open',tunnel:1,grant:grantOf(r.grant({host:'db.example.com',port:5432,tls:'disable'}))});
   expect(await r.closedWith(1)).toBe('forbidden_address');expect(connect).not.toHaveBeenCalled();
  }
 });
 it('fails a name with no answer or a failed lookup as dns_failed',async()=>{
  for(const lookup of [async()=>[],async()=>{throw Object.assign(Error('ENOTFOUND'),{code:'ENOTFOUND'});}]){
   const r=harness({lookup}).run();r.message({type:'tunnel_open',tunnel:1,grant:grantOf(r.grant({host:'db.example.com',port:5432,tls:'verify-full'}))});
   expect(await r.closedWith(1)).toBe('dns_failed');
  }
 });
 it('connects to the exact address it judged (an IP literal: no second lookup), trying vetted answers in order',async()=>{
  const s=await server();
  const lookup=vi.fn(async()=>[{address:'::1',family:6},{address:'127.0.0.1',family:4}]);
  const attempts:Array<{host:string;port:number}>=[];
  const connect=(t:{host:string;port:number;family:number})=>{attempts.push(t);return t.host==='::1'?net.connect({host:'127.0.0.1',port:1}):net.connect({host:t.host,port:s.port});};
  const r=harness({allowLoopback:true,lookup,connect}).run();
  r.message({type:'tunnel_open',tunnel:1,grant:grantOf(r.grant({host:'db.example.com',port:s.port,tls:'disable'}))});
  await r.opened(1);
  expect(lookup).toHaveBeenCalledTimes(1);expect(lookup).toHaveBeenCalledWith('db.example.com');
  expect(attempts).toEqual([{host:'::1',port:s.port,family:6},{host:'127.0.0.1',port:s.port,family:4}]);
  expect(net.isIP(attempts[1]!.host)).toBe(4);
 });
});

describe('refusals before a socket',()=>{
 it('refuses a tunnel for a grant this run was never given, and a reused tunnel id',async()=>{
  const s=await server();const h=harness();const a=h.run(),b=h.run({owner:'owner2',page:'page2'});
  const grant=grantOf(a.grant(target(s.port)));
  b.message({type:'tunnel_open',tunnel:1,grant});a.message({type:'tunnel_open',tunnel:1,grant:'g99'});a.message({type:'tunnel_open',tunnel:2,grant:{} as never});
  expect(await b.closedWith(1)).toBe('unknown_connection');expect(await a.closedWith(1)).toBe('unknown_connection');expect(await a.closedWith(2)).toBe('unknown_connection');
  a.message({type:'tunnel_open',tunnel:3,grant});await a.opened(3);
  a.message({type:'tunnel_open',tunnel:3,grant});expect(await a.closedWith(3)).toBe('tunnel_protocol');
  expect(s.sockets).toHaveLength(1);
 });
 it('refuses a grant after the run closed',()=>{
  const r=harness().run();r.close();expect(()=>r.grant(target(5432))).toThrow('run_revoked');
 });
});

describe('connection limits',()=>{
 it(`opens at most ${RESOLVER_DATABASE_LIMITS.connectionsPerRun} tunnels per run, reconnects included`,async()=>{
  const s=await server();const r=harness().run();const grant=grantOf(r.grant(target(s.port)));
  for(let id=1;id<=RESOLVER_DATABASE_LIMITS.connectionsPerRun;id++){r.message({type:'tunnel_open',tunnel:id,grant});await r.opened(id);r.message({type:'tunnel_close',tunnel:id});}
  r.message({type:'tunnel_open',tunnel:99,grant});expect(await r.closedWith(99)).toBe('tunnel_limit');
  await until(()=>s.sockets.length===RESOLVER_DATABASE_LIMITS.connectionsPerRun);
 });
 it('bounds tunnels open at once per owner and per page across runs, and frees them on close',async()=>{
  const s=await server();
  const h=harness({allowLoopback:true,limits:{connectionsPerOwner:2,connectionsPerPage:3}});
  const runs=[h.run({owner:'o1',page:'p1'}),h.run({owner:'o1',page:'p2'}),h.run({owner:'o1',page:'p3'})];
  for(const r of runs)r.message({type:'tunnel_open',tunnel:1,grant:grantOf(r.grant(target(s.port)))});
  await runs[0]!.opened(1);await runs[1]!.opened(1);expect(await runs[2]!.closedWith(1)).toBe('tunnel_busy');
  expect(h.tunnels.openCount({owner:'o1'})).toBe(2);
  // Another owner on the same page: the page bound applies.
  const pageRuns=[h.run({owner:'a',page:'p1'}),h.run({owner:'b',page:'p1'}),h.run({owner:'c',page:'p1'})];
  for(const r of pageRuns)r.message({type:'tunnel_open',tunnel:1,grant:grantOf(r.grant(target(s.port)))});
  await pageRuns[0]!.opened(1);await pageRuns[1]!.opened(1);expect(await pageRuns[2]!.closedWith(1)).toBe('tunnel_busy');
  expect(h.tunnels.openCount({page:'p1'})).toBe(3);
  runs[0]!.close();expect(h.tunnels.openCount({owner:'o1'})).toBe(1);
  const again=h.run({owner:'o1',page:'p9'});again.message({type:'tunnel_open',tunnel:1,grant:grantOf(again.grant(target(s.port)))});await again.opened(1);
 });
});

describe('timeouts',()=>{
 it('gives up a connection that does not complete within the connect timeout, and destroys the attempt',async()=>{
  const attempt=new net.Socket();
  const r=harness({allowLoopback:true,limits:{connectTimeoutMs:50},connect:()=>attempt}).run();
  r.message({type:'tunnel_open',tunnel:1,grant:grantOf(r.grant(target(5432)))});
  expect(await r.closedWith(1)).toBe('connect_timeout');expect(attempt.destroyed).toBe(true);
 });
 it('counts the lookup inside the connect timeout',async()=>{
  const r=harness({limits:{connectTimeoutMs:50},lookup:()=>new Promise(()=>{})}).run();
  r.message({type:'tunnel_open',tunnel:1,grant:grantOf(r.grant({host:'db.example.com',port:5432,tls:'verify-full'}))});
  expect(await r.closedWith(1)).toBe('connect_timeout');
 });
 it('closes a tunnel with no bytes either way for the idle timeout, at both ends',async()=>{
  const s=await server();const h=harness({allowLoopback:true,limits:{idleTimeoutMs:80}});const r=h.run();
  r.message({type:'tunnel_open',tunnel:1,grant:grantOf(r.grant(target(s.port)))});await r.opened(1);
  r.message({type:'tunnel_data',tunnel:1,data:b64(4)});
  expect(await r.closedWith(1)).toBe('tunnel_idle_timeout');
  await until(()=>s.closed.length===1);expect(h.tunnels.openCount()).toBe(0);
 });
 it('reports a refused connection as connect_failed',async()=>{
  const free=await new Promise<number>(r=>{const t=net.createServer();t.listen(0,'127.0.0.1',()=>{const p=(t.address() as net.AddressInfo).port;t.close(()=>r(p));});});
  const r=harness().run();r.message({type:'tunnel_open',tunnel:1,grant:grantOf(r.grant(target(free)))});
  expect(await r.closedWith(1)).toBe('connect_failed');
 });
});

describe('bytes: forwarded unread, bounded, with backpressure',()=>{
 it('forwards bytes both ways unchanged and acknowledges the worker\'s writes once flushed',async()=>{
  const s=await server(socket=>socket.on('data',b=>socket.write(Buffer.concat([Buffer.from('echo:'),b]))));const r=harness().run();
  r.message({type:'tunnel_open',tunnel:1,grant:grantOf(r.grant(target(s.port)))});await r.opened(1);
  const payload=Buffer.from([0,1,0x62,0x69,0x6e,0xff]);
  r.message({type:'tunnel_data',tunnel:1,data:payload.toString('base64')});
  await until(()=>r.received(1).length>=11);
  expect(r.received(1)).toEqual(Buffer.concat([Buffer.from('echo:'),payload]));
  await until(()=>r.sent.some(m=>m.type==='tunnel_ack'&&m.bytes===6));
 });
 it('stops reading the database once the worker holds a window of unacknowledged bytes, and resumes on acknowledgement',async()=>{
  const window=64*1024;let writer!:net.Socket;
  const s=await server(socket=>{writer=socket;const flood=()=>{while(socket.write(Buffer.alloc(16*1024,0x62)));};socket.on('drain',flood);flood();});
  const r=harness({allowLoopback:true,limits:{windowBytes:window}}).run();
  r.message({type:'tunnel_open',tunnel:1,grant:grantOf(r.grant(target(s.port)))});await r.opened(1);
  await until(()=>r.received(1).length>=window);
  await new Promise(res=>setTimeout(res,150));
  const held=r.received(1).length;
  // At most one socket read past the window, however long the reader stalls; the database side is backed up.
  expect(held).toBeLessThan(window+256*1024);
  await new Promise(res=>setTimeout(res,150));
  expect(r.received(1).length).toBe(held);
  expect(writer.writableLength).toBeGreaterThan(0);
  r.message({type:'tunnel_ack',tunnel:1,bytes:held});
  await until(()=>r.received(1).length>held);
 });
 it('closes a tunnel whose worker writes past its window without waiting for acknowledgements',async()=>{
  // A database that never reads: the controller's writes never flush, so nothing is acknowledged.
  const s=await server(socket=>socket.pause());const r=harness({allowLoopback:true,limits:{windowBytes:8*1024,chunkBytes:4*1024}}).run();
  r.message({type:'tunnel_open',tunnel:1,grant:grantOf(r.grant(target(s.port)))});await r.opened(1);
  for(let i=0;i<4096&&!r.sent.some(m=>m.type==='tunnel_closed');i++)r.message({type:'tunnel_data',tunnel:1,data:b64(4*1024)});
  expect(await r.closedWith(1)).toBe('tunnel_window_exceeded');
 });
 it('caps bytes from the database per run',async()=>{
  const s=await server(socket=>socket.write(Buffer.alloc(32*1024)));const r=harness({allowLoopback:true,limits:{bytesInPerRun:16*1024}}).run();
  const grant=grantOf(r.grant(target(s.port)));
  r.message({type:'tunnel_open',tunnel:1,grant});
  expect(await r.closedWith(1)).toBe('tunnel_byte_limit');
  expect(r.received(1).length).toBeLessThanOrEqual(16*1024);
  r.message({type:'tunnel_open',tunnel:2,grant});expect(await r.closedWith(2)).toBe('tunnel_byte_limit');
 });
 it('caps bytes to the database per run',async()=>{
  const s=await server();const r=harness({allowLoopback:true,limits:{bytesOutPerRun:10*1024}}).run();
  r.message({type:'tunnel_open',tunnel:1,grant:grantOf(r.grant(target(s.port)))});await r.opened(1);
  for(let i=0;i<3;i++)r.message({type:'tunnel_data',tunnel:1,data:b64(4*1024)});
  expect(await r.closedWith(1)).toBe('tunnel_byte_limit');
  await until(()=>s.closed.length===1);expect(s.received().length).toBeLessThanOrEqual(10*1024);
 });
 it('refuses malformed payloads, oversize chunks, data before the tunnel opened and acknowledgements of bytes never sent',async()=>{
  const s=await server();
  for(const bad of [{type:'tunnel_data',data:'%%%%'},{type:'tunnel_data',data:''},{type:'tunnel_data',data:7},{type:'tunnel_data',data:b64(64*1024+3)},{type:'tunnel_ack',bytes:1},{type:'tunnel_ack',bytes:-1},{type:'tunnel_wat'}]){
   const r=harness().run();r.message({type:'tunnel_open',tunnel:1,grant:grantOf(r.grant(target(s.port)))});await r.opened(1);
   r.message({...bad,tunnel:1});expect(await r.closedWith(1),JSON.stringify(bad).slice(0,60)).toBe('tunnel_protocol');
  }
  const sent:Sent[]=[];const r=createDatabaseTunnels({allowLoopback:true,limits:{connectTimeoutMs:5000},lookup:()=>new Promise(()=>{})}).forRun({owner:'o',page:'p'},m=>sent.push(m as Sent));cleanup.push(()=>r.close());
  r.message({type:'tunnel_open',tunnel:1,grant:grantOf(r.grant({host:'db.example.com',port:5432,tls:'disable'}))});
  r.message({type:'tunnel_data',tunnel:1,data:b64(3)});
  expect(sent).toEqual([{type:'tunnel_closed',tunnel:1,error:'tunnel_protocol'}]);
 });
 it('bounds the tunnel messages one run may send',async()=>{
  const s=await server();const r=harness({allowLoopback:true,limits:{messagesPerRun:20}}).run();
  r.message({type:'tunnel_open',tunnel:1,grant:grantOf(r.grant(target(s.port)))});await r.opened(1);
  for(let i=0;i<30;i++)r.message({type:'tunnel_data',tunnel:1,data:b64(3)});
  expect(await r.closedWith(1)).toBe('tunnel_message_limit');
 });
});

describe('cleanup',()=>{
 it('closes every tunnel of a run at once, open or still connecting, with no orphan socket and no further messages',async()=>{
  const s=await server();let pending:((v:{address:string;family:number}[])=>void)|undefined;
  const h=harness({allowLoopback:true,lookup:()=>new Promise(resolve=>{pending=resolve;})});const r=h.run();const other=h.run({owner:'owner2',page:'page2'});
  const grant=grantOf(r.grant(target(s.port)));
  for(const id of [1,2,3])r.message({type:'tunnel_open',tunnel:id,grant});
  r.message({type:'tunnel_open',tunnel:4,grant:grantOf(r.grant({host:'db.example.com',port:s.port,tls:'disable'}))});
  other.message({type:'tunnel_open',tunnel:1,grant:grantOf(other.grant(target(s.port)))});
  for(const id of [1,2,3])await r.opened(id);await other.opened(1);
  expect(h.tunnels.openCount()).toBe(5);
  const before=r.sent.length;r.close();
  expect(h.tunnels.openCount()).toBe(1);
  await until(()=>s.closed.length===3);
  // The connection still resolving when the run ended never connects.
  pending!([{address:'127.0.0.1',family:4}]);await new Promise(res=>setTimeout(res,50));
  expect(s.sockets).toHaveLength(4);expect(r.sent.length).toBe(before);
  r.message({type:'tunnel_open',tunnel:9,grant});expect(r.sent.length).toBe(before);
  other.close();await until(()=>s.closed.length===4);expect(h.tunnels.openCount()).toBe(0);
 });
 it('tells the worker when the database closes the connection, and releases it',async()=>{
  const s=await server(socket=>socket.end('bye'));const h=harness();const r=h.run();
  r.message({type:'tunnel_open',tunnel:1,grant:grantOf(r.grant(target(s.port)))});
  expect(await r.closedWith(1)).toBeUndefined();expect(r.received(1).toString()).toBe('bye');expect(h.tunnels.openCount()).toBe(0);
 });
});
