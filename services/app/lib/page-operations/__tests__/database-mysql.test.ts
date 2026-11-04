/**
 * END TO END: a compiled resolver → `caps.db` (a `'mysql'` name) → the worker's mysql2 → the controller's tunnel → a
 * real MySQL 8 (a disposable `mysql:8` container with TLS on, certificates made here by openssl), the same cases as
 * database-postgres.test.ts. TLS runs from the driver to the server: `verify-full` accepts the right CA and name (DNS
 * or IP), and refuses a wrong CA, a wrong name, an unknown root and a second server with TLS off (each with its own code); the controller's socket carries no plaintext SQL
 * when TLS is on. Also the type mapping (README) and the refusal of LOCAL INFILE and multiple statements by a server
 * that allows both. The runner's address policy is the development opt-in (the container listens on loopback), with an
 * injected lookup so test names reach it. Runs in the `integration` project (CI's integration job and runner design
 * validation, the latter with the Docker worker via RUNNER_TEST_IMAGE); skipped without the image.
 */
import {execFileSync,spawnSync} from 'node:child_process';
import {mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import {createRunner} from '@artifactbin/runner/local';
import {createBackendCompiler,createBackendInvoker,pageBackendCapability,type PageBackendRecord} from '../backend';

const IMAGE='mysql:8';
const dockerAvailable=spawnSync('docker',['image','inspect',IMAGE],{stdio:'ignore'}).status===0;
const READER_PASSWORD='reader-pa55-f0r-tests',BAD_PASSWORD='not-the-reader-password',OWNER_PASSWORD='owner-pa55';
const SOURCE=`export const secrets={PLAIN:'mysql',TLS:'mysql',TLS_IP:'mysql',WRONG_CA:'mysql',WRONG_NAME:'mysql',NO_CA:'mysql',NO_TLS:'mysql',BAD_PASSWORD:'mysql',OWNER:'mysql'};
export const typeDefs="type Query { orders(min:Int!): String probe(name:String!): String session: String types: String refusals: String }";
const attempt=(f)=>f().then(r=>r,e=>({code:e.code,message:e.message}));
export default {
 orders: async({min},p,caps)=>{const db=await caps.db('PLAIN');try{return JSON.stringify(await db.query('select id, item, amount, placed from orders where amount >= ? order by id',[min]));}finally{await db.end();}},
 probe: async({name},p,caps)=>{const db=await caps.db(name);try{return JSON.stringify((await db.query("show session status like 'Ssl_version'")).rows[0]);}catch(e){return JSON.stringify({code:e.code,message:e.message});}finally{await db.end();}},
 session: async(a,p,caps)=>{
  const db=await caps.db('TLS');
  try{
   await db.query('start transaction');
   await db.query('select id from orders limit 1');
   const one=(await db.query('select trx_id as t from information_schema.innodb_trx where trx_mysql_thread_id = connection_id()')).rows[0]?.t??null;
   const two=(await db.query('select trx_id as t from information_schema.innodb_trx where trx_mysql_thread_id = connection_id()')).rows[0]?.t??null;
   await db.query('commit');
   const write=await db.query("insert into orders(item, amount) values ('x', 1)").then(()=>'wrote',e=>e.message);
   return JSON.stringify({sameTransaction:one!==null&&one===two,write});
  }finally{await db.end();}
 },
 types: async(a,p,caps)=>{
  const db=await caps.db('TLS');
  try{
   const r=await db.query("select cast(? as signed) as big, cast(12.5 as decimal(10,2)) as dec_, x'00ff' as bin, cast('2026-11-01 10:20:30' as datetime) as at, from_unixtime(0) as epoch, json_object('a', 1) as doc, 1.5e0 as dbl, cast(null as char) as nothing, true as flag",['9007199254740993']);
   const row=r.rows[0];
   return JSON.stringify({...row,bin:Array.from(row.bin),binType:Object.prototype.toString.call(row.bin),atType:Object.prototype.toString.call(row.at),columns:r.columns,command:r.command,count:r.count});
  }finally{await db.end();}
 },
 refusals: async(a,p,caps)=>{
  const db=await caps.db('OWNER');
  try{
   return JSON.stringify({
    infile:await attempt(()=>db.query("load data local infile '/etc/hostname' into table scratch")),
    multi:await attempt(()=>db.query('select 1; select 2')),
    update:await db.query("update scratch set v = 'y' where v = 'x'").then(r=>({command:r.command,count:r.count,rows:r.rows,columns:r.columns})),
    rows:(await db.query('select count(*) as n from scratch')).rows,
   });
  }finally{await db.end();}
 },
};`;

describe.skipIf(!dockerAvailable)('caps.db against a real MySQL 8 over TLS',()=>{
 let container='',plain='',dir='',port=0,plainPort=0;
 let runner:Awaited<ReturnType<typeof createRunner>>,db:PGlite,record:PageBackendRecord,invoke:ReturnType<typeof createBackendInvoker>;
 const written:Buffer[]=[];
 beforeAll(async()=>{
  dir=mkdtempSync(path.join(os.tmpdir(),'afbin-my-tls-'));
  const ssl=(...args:string[])=>execFileSync('openssl',args,{cwd:dir,stdio:'pipe'});
  for(const name of ['ca','other'])ssl('req','-x509','-newkey','rsa:2048','-nodes','-keyout',`${name}.key`,'-out',`${name}.crt`,'-subj',`/CN=artifactbin ${name} test root`,'-days','2','-addext','basicConstraints=critical,CA:TRUE','-addext','keyUsage=critical,keyCertSign,cRLSign');
  ssl('req','-newkey','rsa:2048','-nodes','-keyout','server.key','-out','server.csr','-subj','/CN=db.example.com');
  writeFileSync(path.join(dir,'server.ext'),'subjectAltName=DNS:db.example.com,IP:127.0.0.1\nextendedKeyUsage=serverAuth\n');
  ssl('x509','-req','-in','server.csr','-CA','ca.crt','-CAkey','ca.key','-CAcreateserial','-out','server.crt','-days','2','-extfile','server.ext');
  const read=(name:string)=>readFileSync(path.join(dir,name),'utf8');
  // The key must be readable by the server's user: written inside the container before the entrypoint. The server
  // allows LOCAL INFILE, so refusing it is the client's doing.
  container=execFileSync('docker',['run','--rm','-d','-e',`MYSQL_ROOT_PASSWORD=${OWNER_PASSWORD}`,'-e','MYSQL_DATABASE=shop','-e',`CA=${read('ca.crt')}`,'-e',`CERT=${read('server.crt')}`,'-e',`KEY=${read('server.key')}`,'-p','127.0.0.1::3306','--entrypoint','sh',IMAGE,'-c',
   'mkdir -p /tmp/tls && printf "%s\\n" "$CA" > /tmp/tls/ca.crt && printf "%s\\n" "$CERT" > /tmp/tls/server.crt && printf "%s\\n" "$KEY" > /tmp/tls/server.key && chown -R mysql /tmp/tls && chmod 600 /tmp/tls/server.key && exec docker-entrypoint.sh mysqld --ssl-ca=/tmp/tls/ca.crt --ssl-cert=/tmp/tls/server.crt --ssl-key=/tmp/tls/server.key --local-infile=1'],{encoding:'utf8'}).trim();
  // A second server with TLS off (an empty tls_version list), started before either is waited for.
  plain=execFileSync('docker',['run','--rm','-d','-e',`MYSQL_ROOT_PASSWORD=${OWNER_PASSWORD}`,'-p','127.0.0.1::3306',IMAGE,'--tls-version='],{encoding:'utf8'}).trim();
  const portOf=(id:string)=>Number(execFileSync('docker',['port',id,'3306/tcp'],{encoding:'utf8'}).trim().split('\n')[0]!.split(':').at(-1));
  port=portOf(container);plainPort=portOf(plain);
  // Over TCP: the entrypoint's initialization server listens on its socket only.
  const sql=(text:string)=>spawnSync('docker',['exec',container,'mysql','-h127.0.0.1','-uroot',`-p${OWNER_PASSWORD}`,'shop','-e',text],{encoding:'utf8'});
  // The TLS-off server needs no setup, only to listen on TCP: mysqladmin ping succeeds on any answer, a refused login included.
  const ready=(id:string)=>id===container?sql('select 1').status===0:spawnSync('docker',['exec',id,'mysqladmin','-h127.0.0.1','ping'],{stdio:'ignore'}).status===0;
  for(const id of [container,plain])for(let attempt=0;;attempt++){
   if(ready(id))break;
   if(attempt>180)throw Error(`${IMAGE} never became ready`);
   await new Promise(r=>setTimeout(r,500));
  }
  const setup=sql(`create table orders(id int auto_increment primary key, item varchar(20) not null, amount int not null, placed date not null default ('2026-11-01'));
   insert into orders(item, amount) values ('tea', 4), ('cake', 12), ('pie', 30);
   create table scratch(v varchar(8)); insert into scratch values ('x'), ('x'), ('z');
   create user 'reader'@'%' identified by '${READER_PASSWORD}'; grant select on shop.orders to 'reader'@'%';
   grant process on *.* to 'reader'@'%';`);
  if(setup.status!==0)throw Error(setup.stderr);
  const base={kind:'mysql',port,database:'shop',user:'reader',password:READER_PASSWORD};
  const values:Record<string,string>=Object.fromEntries(Object.entries({
   PLAIN:{...base,host:'127.0.0.1',tls:'disable'},
   TLS:{...base,host:'db.example.com',tls:'verify-full',ca:read('ca.crt')},
   TLS_IP:{...base,host:'127.0.0.1',tls:'verify-full',ca:read('ca.crt')},
   WRONG_CA:{...base,host:'db.example.com',tls:'verify-full',ca:read('other.crt')},
   WRONG_NAME:{...base,host:'wrong.example.com',tls:'verify-full',ca:read('ca.crt')},
   NO_CA:{...base,host:'db.example.com',tls:'verify-full'},
   NO_TLS:{...base,host:'127.0.0.1',port:plainPort,tls:'verify-full',ca:read('ca.crt')},
   BAD_PASSWORD:{...base,host:'db.example.com',tls:'verify-full',ca:read('ca.crt'),password:BAD_PASSWORD},
   OWNER:{...base,host:'db.example.com',tls:'verify-full',ca:read('ca.crt'),user:'root',password:OWNER_PASSWORD},
  }).map(([name,value])=>[name,JSON.stringify(value)]));
  const readSecret=async(_b:PageBackendRecord,name:string)=>values[name]??Promise.reject(Error('backend_secret_unavailable'));
  db=new PGlite();
  runner=await createRunner({db,dockerImage:process.env.RUNNER_TEST_IMAGE,
   database:{allowLoopback:true,lookup:async host=>host.endsWith('.example.com')?[{address:'127.0.0.1',family:4}]:[],
    // Records what the controller writes to the database, to show it forwards ciphertext only.
    connect:target=>{const socket=net.connect(target);const write=socket.write.bind(socket) as (b:Buffer,cb?:(e?:Error|null)=>void)=>boolean;socket.write=((b:Buffer,cb?:(e?:Error|null)=>void)=>{written.push(Buffer.from(b));return write(b,cb);}) as typeof socket.write;return socket;}},
   capabilities:async(ctx,operation,args)=>pageBackendCapability(ctx.request,operation,args,async()=>record,readSecret,undefined,undefined,ctx.signal)});
  record={...(await createBackendCompiler(runner)(SOURCE)),source:SOURCE,backendId:'b1',pageId:'page1',version:'v1',ownerId:'owner1'};
  invoke=createBackendInvoker(runner,async()=>record,{readSecret});
 },180_000);
 afterAll(async()=>{await runner?.close();await db?.close();for(const id of [container,plain])if(id)spawnSync('docker',['rm','-f',id],{stdio:'ignore'});if(dir)rmSync(dir,{recursive:true,force:true});});
 const query=async(field:string,args:Record<string,unknown>={})=>{written.length=0;const out=await invoke({namespace:'db',fileId:'b1',version:'v1',operation:'query',field,args:args as never,principal:{tenant:'page1',subject:'viewer1',role:'viewer'},signal:new AbortController().signal});return JSON.parse(out as string);};
 const TLS_VERSION={Variable_name:'Ssl_version',Value:expect.stringMatching(/^TLSv1\.[23]$/)};
 const UNTRUSTED={code:'tls_untrusted_certificate',message:'add your provider\'s CA certificate to the connection (RDS, Cloud SQL and Supabase need one)'};

 it('returns rows, columns and the command from a parameterized query',async()=>{
  expect(await query('orders',{min:10})).toEqual({rows:[{id:2,item:'cake',amount:12,placed:'2026-11-01T00:00:00.000Z'},{id:3,item:'pie',amount:30,placed:'2026-11-01T00:00:00.000Z'}],columns:['id','item','amount','placed'],command:'SELECT',count:2});
  expect(Buffer.concat(written).toString('latin1')).toContain('select id, item, amount');
 },45_000);
 it('connects with TLS verify-full to a DNS name and to an IP address, and the controller sees no plaintext',async()=>{
  expect(await query('probe',{name:'TLS'})).toEqual(TLS_VERSION);
  expect(Buffer.concat(written).toString('latin1')).not.toContain('Ssl_version');
  expect(await query('probe',{name:'TLS_IP'})).toEqual(TLS_VERSION);
  expect(await query('probe',{name:'PLAIN'})).toEqual({Variable_name:'Ssl_version',Value:''});
  expect(Buffer.concat(written).toString('latin1')).toContain('Ssl_version');
 },45_000);
 it('refuses a certificate from another root, for another name, or with no configured root',async()=>{
  expect(await query('probe',{name:'WRONG_CA'})).toEqual(UNTRUSTED);
  expect(await query('probe',{name:'WRONG_NAME'})).toEqual({code:'tls_name_mismatch',message:expect.stringContaining('does not name this host')});
  expect(await query('probe',{name:'NO_CA'})).toEqual(UNTRUSTED);
 },45_000);
 it('names a server with TLS off',async()=>{
  expect(await query('probe',{name:'NO_TLS'})).toEqual({code:'tls_unsupported',message:'the database server does not offer TLS; enable TLS on the server'});
 },45_000);
 it('keeps one session per handle, and leaves read-only enforcement to the database user',async()=>{
  expect(await query('session')).toEqual({sameTransaction:true,write:expect.stringMatching(/^42000 INSERT command denied to user 'reader'@'[^']+' for table [`']?orders[`']?$/)});
 },45_000);
 it('reports a rejected password without it',async()=>{
  const out=await query('probe',{name:'BAD_PASSWORD'});
  expect(out).toEqual({code:'database_error',message:expect.stringMatching(/^28000 Access denied for user 'reader'@'[^']+' \(using password: YES\)$/)});
  expect(JSON.stringify(out)).not.toContain(BAD_PASSWORD);
 },45_000);
 it('maps BIGINT and DECIMAL to strings, dates to UTC Dates, binary to bytes and JSON to values',async()=>{
  expect(await query('types')).toEqual({big:'9007199254740993',dec_:'12.50',bin:[0,255],binType:'[object Uint8Array]',at:'2026-11-01T10:20:30.000Z',atType:'[object Date]',epoch:'1970-01-01T00:00:00.000Z',
   doc:{a:1},dbl:1.5,nothing:null,flag:'1',columns:['big','dec_','bin','at','epoch','doc','dbl','nothing','flag'],command:'SELECT',count:1});
 },45_000);
 it('refuses LOCAL INFILE and multiple statements even where the server allows them, and counts matched rows',async()=>{
  const out=await query('refusals');
  expect(out.infile.code).toBe('database_error');expect(out.infile.message).toMatch(/LOCAL|local/);
  expect(out.multi).toEqual({code:'database_error',message:expect.stringMatching(/^42000 You have an error in your SQL syntax/)});
  expect(out.update).toEqual({command:'UPDATE',count:2,rows:[],columns:[]});
  expect(out.rows).toEqual([{n:'3'}]);
 },45_000);
});
