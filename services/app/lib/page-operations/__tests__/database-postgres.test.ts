/**
 * END TO END: a compiled resolver → `caps.db` (a `'postgres'` name) → the worker's postgres.js → the controller's tunnel → a real
 * PostgreSQL 17 (a disposable `postgres:17-alpine` container with TLS on, certificates made here by openssl).
 * TLS runs from the driver to the server: `verify-full` accepts the right CA and name (DNS or IP), and refuses a
 * wrong CA, a wrong name, an unknown root and a second server with TLS off (each with its own code); the controller's socket carries no plaintext SQL when TLS is on.
 * The runner's address policy is the development opt-in (the container listens on loopback), with an injected
 * lookup so test names reach it. Runs in the `integration` project (CI's integration job and runner design
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

const dockerAvailable=spawnSync('docker',['image','inspect','postgres:17-alpine'],{stdio:'ignore'}).status===0;
const READER_PASSWORD='reader-pa55-f0r-tests',BAD_PASSWORD='not-the-reader-password';
const SOURCE=`export const secrets={PLAIN:'postgres',TLS:'postgres',TLS_IP:'postgres',WRONG_CA:'postgres',WRONG_NAME:'postgres',NO_CA:'postgres',NO_TLS:'postgres',BAD_PASSWORD:'postgres'};
export const typeDefs="type Query { orders(min:Int!): String probe(name:String!): String session: String }";
export default {
 orders: async({min},p,caps)=>{const db=await caps.db('PLAIN');try{return JSON.stringify(await db.query('select id, item, amount, placed from orders where amount >= $1 order by id',[min]));}finally{await db.end();}},
 probe: async({name},p,caps)=>{const db=await caps.db(name);try{return JSON.stringify((await db.query('select ssl, version from pg_stat_ssl where pid = pg_backend_pid()')).rows[0]);}catch(e){return JSON.stringify({code:e.code,message:e.message});}finally{await db.end();}},
 session: async(a,p,caps)=>{
  const db=await caps.db('TLS');
  try{
   await db.query('begin');
   const one=(await db.query('select txid_current() as t')).rows[0].t,two=(await db.query('select txid_current() as t')).rows[0].t;
   await db.query('commit');
   const write=await db.query("insert into orders(item, amount) values ('x', 1)").then(()=>'wrote',e=>e.message);
   return JSON.stringify({sameTransaction:one===two,write});
  }finally{await db.end();}
 },
};`;

describe.skipIf(!dockerAvailable)('caps.db against a real PostgreSQL over TLS',()=>{
 let container='',plain='',dir='',port=0,plainPort=0;
 let runner:Awaited<ReturnType<typeof createRunner>>,db:PGlite,record:PageBackendRecord,invoke:ReturnType<typeof createBackendInvoker>;
 const written:Buffer[]=[];
 beforeAll(async()=>{
  dir=mkdtempSync(path.join(os.tmpdir(),'afbin-pg-tls-'));
  const ssl=(...args:string[])=>execFileSync('openssl',args,{cwd:dir,stdio:'pipe'});
  for(const name of ['ca','other'])ssl('req','-x509','-newkey','rsa:2048','-nodes','-keyout',`${name}.key`,'-out',`${name}.crt`,'-subj',`/CN=artifactbin ${name} test root`,'-days','2','-addext','basicConstraints=critical,CA:TRUE','-addext','keyUsage=critical,keyCertSign,cRLSign');
  ssl('req','-newkey','rsa:2048','-nodes','-keyout','server.key','-out','server.csr','-subj','/CN=db.example.com');
  writeFileSync(path.join(dir,'server.ext'),'subjectAltName=DNS:db.example.com,IP:127.0.0.1\nextendedKeyUsage=serverAuth\n');
  ssl('x509','-req','-in','server.csr','-CA','ca.crt','-CAkey','ca.key','-CAcreateserial','-out','server.crt','-days','2','-extfile','server.ext');
  const read=(name:string)=>readFileSync(path.join(dir,name),'utf8');
  // The key must belong to the server's user with mode 0600: written inside the container before the entrypoint.
  container=execFileSync('docker',['run','--rm','-d','-e','POSTGRES_PASSWORD=owner-pass','-e','POSTGRES_DB=shop','-e',`CERT=${read('server.crt')}`,'-e',`KEY=${read('server.key')}`,'-p','127.0.0.1::5432','--entrypoint','sh','postgres:17-alpine','-c',
   'printf "%s\\n" "$CERT" > /tmp/server.crt && printf "%s\\n" "$KEY" > /tmp/server.key && chown postgres /tmp/server.crt /tmp/server.key && chmod 600 /tmp/server.key && exec docker-entrypoint.sh postgres -c ssl=on -c ssl_cert_file=/tmp/server.crt -c ssl_key_file=/tmp/server.key'],{encoding:'utf8'}).trim();
  // A second server with TLS off (the image's default), started before either is waited for.
  plain=execFileSync('docker',['run','--rm','-d','-e','POSTGRES_PASSWORD=owner-pass','-p','127.0.0.1::5432','postgres:17-alpine'],{encoding:'utf8'}).trim();
  const portOf=(id:string)=>Number(execFileSync('docker',['port',id,'5432/tcp'],{encoding:'utf8'}).trim().split('\n')[0]!.split(':').at(-1));
  port=portOf(container);plainPort=portOf(plain);
  for(const id of [container,plain])for(let attempt=0;;attempt++){
   if(spawnSync('docker',['exec',id,'pg_isready','-h','127.0.0.1','-U','postgres'],{stdio:'ignore'}).status===0)break;
   if(attempt>120)throw Error('postgres:17-alpine never became ready');
   await new Promise(r=>setTimeout(r,500));
  }
  execFileSync('docker',['exec',container,'psql','-v','ON_ERROR_STOP=1','-U','postgres','-d','shop','-c',
   `create table orders(id serial primary key, item text not null, amount int not null, placed date not null default '2026-11-01');
    insert into orders(item, amount) values ('tea', 4), ('cake', 12), ('pie', 30);
    create role reader login password '${READER_PASSWORD}'; grant select on orders to reader;`],{stdio:'pipe'});
  const base={kind:'postgres',port,database:'shop',user:'reader',password:READER_PASSWORD};
  const values:Record<string,string>=Object.fromEntries(Object.entries({
   PLAIN:{...base,host:'127.0.0.1',tls:'disable'},
   TLS:{...base,host:'db.example.com',tls:'verify-full',ca:read('ca.crt')},
   TLS_IP:{...base,host:'127.0.0.1',tls:'verify-full',ca:read('ca.crt')},
   WRONG_CA:{...base,host:'db.example.com',tls:'verify-full',ca:read('other.crt')},
   WRONG_NAME:{...base,host:'wrong.example.com',tls:'verify-full',ca:read('ca.crt')},
   NO_CA:{...base,host:'db.example.com',tls:'verify-full'},
   NO_TLS:{...base,host:'127.0.0.1',port:plainPort,tls:'verify-full',ca:read('ca.crt')},
   BAD_PASSWORD:{...base,host:'db.example.com',tls:'verify-full',ca:read('ca.crt'),password:BAD_PASSWORD},
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
 },120_000);
 afterAll(async()=>{await runner?.close();await db?.close();for(const id of [container,plain])if(id)spawnSync('docker',['rm','-f',id],{stdio:'ignore'});if(dir)rmSync(dir,{recursive:true,force:true});});
 const query=async(field:string,args:Record<string,unknown>={})=>{written.length=0;const out=await invoke({namespace:'db',fileId:'b1',version:'v1',operation:'query',field,args:args as never,principal:{tenant:'page1',subject:'viewer1',role:'viewer'},signal:new AbortController().signal});return JSON.parse(out as string);};

 it('returns rows, columns and the command from a parameterized query',async()=>{
  expect(await query('orders',{min:10})).toEqual({rows:[{id:2,item:'cake',amount:12,placed:'2026-11-01T00:00:00.000Z'},{id:3,item:'pie',amount:30,placed:'2026-11-01T00:00:00.000Z'}],columns:['id','item','amount','placed'],command:'SELECT',count:2});
  expect(Buffer.concat(written).toString('latin1')).toContain('select id, item, amount');
 },45_000);
 it('connects with TLS verify-full to a DNS name and to an IP address, and the controller sees no plaintext',async()=>{
  expect(await query('probe',{name:'TLS'})).toEqual({ssl:true,version:expect.stringMatching(/^TLSv1\.[23]$/)});
  expect(Buffer.concat(written).toString('latin1')).not.toContain('pg_stat_ssl');
  expect(await query('probe',{name:'TLS_IP'})).toEqual({ssl:true,version:expect.stringMatching(/^TLSv1\.[23]$/)});
  expect(await query('probe',{name:'PLAIN'})).toEqual({ssl:false,version:null});
  expect(Buffer.concat(written).toString('latin1')).toContain('pg_stat_ssl');
 },45_000);
 const UNTRUSTED={code:'tls_untrusted_certificate',message:'add your provider\'s CA certificate to the connection (RDS, Cloud SQL and Supabase need one)'};
 it('refuses a certificate from another root, for another name, or with no configured root',async()=>{
  expect(await query('probe',{name:'WRONG_CA'})).toEqual(UNTRUSTED);
  expect(await query('probe',{name:'WRONG_NAME'})).toEqual({code:'tls_name_mismatch',message:expect.stringContaining('does not name this host')});
  expect(await query('probe',{name:'NO_CA'})).toEqual(UNTRUSTED);
 },45_000);
 it('names a server with TLS off, which postgres.js meets as a reset',async()=>{
  expect(await query('probe',{name:'NO_TLS'})).toEqual({code:'tls_unsupported',message:'the database server does not offer TLS; enable TLS on the server'});
 },45_000);
 it('keeps one session per handle, and leaves read-only enforcement to the database user',async()=>{
  expect(await query('session')).toEqual({sameTransaction:true,write:'42501 permission denied for table orders'});
 },45_000);
 it('reports a rejected password without it',async()=>{
  const out=await query('probe',{name:'BAD_PASSWORD'});
  expect(out).toEqual({code:'database_error',message:'28P01 password authentication failed for user "reader"'});
  expect(JSON.stringify(out)).not.toContain(BAD_PASSWORD);
 },45_000);
});
