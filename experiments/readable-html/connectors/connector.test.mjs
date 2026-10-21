import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import {createServer} from 'node:http';
import {testDatabase} from '../../../test/postgres.js';
import {createConnectorHost, validateJson} from './host.mjs';
const caller={userId:'alice',tenantId:'a',grants:['db','api']};
const denied=code=>e=>e.code===code && !/password|secret|SELECT|INSERT/.test(e.message);
test('JSON boundary rejects lossy or executable values',()=>{
  for(const value of [undefined,NaN,Infinity,1n,()=>{},new Date(),{x:undefined},Object.assign([],{x:1}),new Array(2),Object.defineProperty({},'x',{get(){throw Error('executed')},enumerable:true})]) assert.throws(()=>validateJson(value),denied('INVALID'));
  const sparseDecorated=Array(2);sparseDecorated[1]=1;sparseDecorated.foo=2;assert.throws(()=>validateJson(sparseDecorated),denied('INVALID'));
  const cycle={};cycle.x=cycle;assert.throws(()=>validateJson(cycle),denied('INVALID'));
  assert.deepEqual(validateJson({a:[null,true,2,'ok']}),{a:[null,true,2,'ok']});
});
test('real PostgreSQL: tenants, injection, rollback, deadlines, cancellation, checkout, shutdown',async()=>{
 const db=await testDatabase();
 const pool=new pg.Pool({connectionString:db.connectionString,options:`-c search_path=${db.schema},public`,max:1,connectionTimeoutMillis:100});
 const ops={
 put:{text:'INSERT INTO notes(tenant,id,body) VALUES($1,$2,$3) RETURNING id,body',params:(c,i)=>[c.tenantId,i.id,i.body]},
 list:{text:'SELECT id,body FROM notes WHERE tenant=$1 ORDER BY id',params:c=>[c.tenantId]},
 slow:{text:'SELECT pg_sleep(2)',params:()=>[]},
 serverTimeout:{text:"SELECT set_config('statement_timeout','1',true)",params:()=>[]},
 badjson:{text:'SELECT now() AS value',params:()=>[]},
 };
 const host=createConnectorHost({db:{kind:'postgres',pool,operations:ops}},{timeoutMs:150});
 try {
 await db.pool.query('CREATE TABLE notes(tenant text,id text,body text,PRIMARY KEY(tenant,id))');
 const call=(operation,input=null,c=caller,s)=>host.invoke(c,{resource:'db',operation,input},s);
 await assert.rejects(call('list',null,{...caller,grants:[]}),denied('DENIED'));
 await assert.rejects(call('__proto__'),denied('DENIED'));
 await assert.rejects(host.invoke(caller,{resource:'__proto__',operation:'list',input:null}),denied('DENIED'));
 const attack="x'); DROP TABLE notes;--";
 await call('put',{id:'1',body:attack});
 assert.deepEqual(await call('list'),[{id:'1',body:attack}]);
 assert.deepEqual(await call('list',null,{...caller,tenantId:'b'}),[]);
 await assert.rejects(host.transaction(caller,'db',[{operation:'put',input:{id:'2',body:'rollback'}},{operation:'put',input:{id:'1',body:'duplicate'}}]),denied('CONFLICT'));
 assert.equal((await call('list')).length,1);
 const committed=await host.transaction(caller,'db',[{operation:'put',input:{id:'committed',body:'yes'}},{operation:'list',input:null}]);assert.equal(committed[1].length,2);
 await db.pool.query('DELETE FROM notes WHERE id=$1',['committed']);
 await assert.rejects(host.transaction(caller,'db',[{operation:'serverTimeout',input:null},{operation:'slow',input:null}]),denied('TIMEOUT'));
 const locked=await pool.connect();const mutable={...caller,grants:['db']};const input={id:'immutable',body:'original'};
 const immutable=call('put',input,mutable);mutable.tenantId='b';input.body='changed';locked.release();await immutable;
 assert.deepEqual(await call('list',null,{...caller,tenantId:'b'}),[]);
 await db.pool.query('DELETE FROM notes WHERE id=$1',['immutable']);
 await assert.rejects(call('badjson'),denied('INVALID'));
 let t=performance.now(); await assert.rejects(call('slow'),denied('TIMEOUT'));assert.ok(performance.now()-t<750);
 const controller=new AbortController();const pending=call('slow',null,caller,controller.signal);setTimeout(()=>controller.abort(),25);await assert.rejects(pending,denied('CANCELLED'));
 assert.equal((await call('list')).length,1);
 const held=await pool.connect();try{
  await assert.rejects(call('list'),denied('UNAVAILABLE'));
  const waiting=new AbortController();const queued=call('list',null,caller,waiting.signal);setTimeout(()=>waiting.abort(),10);await assert.rejects(queued,denied('CANCELLED'));
 }finally{held.release();}
 await new Promise(r=>setTimeout(r,20));assert.equal((await call('list')).length,1);
 const cancelWrite=new AbortController();const writing=host.transaction(caller,'db',[{operation:'put',input:{id:'3',body:'must rollback'}},{operation:'slow',input:null}],cancelWrite.signal);setTimeout(()=>cancelWrite.abort(),25);await assert.rejects(writing,denied('CANCELLED'));assert.equal((await call('list')).length,1);
 const stopped=new AbortController();stopped.abort();await assert.rejects(call('list',null,caller,stopped.signal),denied('CANCELLED'));
 // Negative control proves the tenant test detects a deliberately unscoped query.
 const unsafe=await db.pool.query('SELECT body FROM notes');assert.notDeepEqual(unsafe.rows,await call('list',null,{...caller,tenantId:'b'}));
 const active=call('slow');const rejected=assert.rejects(active,denied('CANCELLED'));await new Promise(r=>setTimeout(r,10));await host.close();await rejected;await assert.rejects(call('list'),denied('CLOSED'));
 console.log(JSON.stringify({postgres:'17.11',checks:'real query / rollback / deadline / abort / checkout / isolation',poolTotal:pool.totalCount}));
 }finally{await host.close();await db.cleanup();}
 const failedPool=new pg.Pool({host:'127.0.0.1',port:1,connectionTimeoutMillis:80});
 const failed=createConnectorHost({db:{kind:'postgres',pool:failedPool,operations:ops}});
 await assert.rejects(failed.invoke(caller,{resource:'db',operation:'list',input:null}),denied('UNAVAILABLE'));await failed.close();
});
test('real HTTP: configured endpoint, identity injection, redirects, bad JSON, sizes, abort, error secrecy',async()=>{
 const seen=[];const server=createServer(async(req,res)=>{
 let text='';for await(const b of req)text+=b;seen.push({url:req.url,authorization:req.headers.authorization,body:JSON.parse(text)});
 if(req.url==='/slow'){setTimeout(()=>res.end('{}'),300);return;}
 if(req.url==='/redirect'){res.writeHead(302,{Location:'/secret'}).end();return;}
 if(req.url==='/bad'){res.end('not json');return;}
 if(req.url==='/large'){res.end(JSON.stringify('x'.repeat(5000)));return;}
 if(req.url==='/lost'){res.destroy();return;}
 if(req.url==='/error'){res.writeHead(500).end('secret');return;}
 res.end(JSON.stringify({tenant:JSON.parse(text).caller.tenantId}));
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const operations=Object.fromEntries(['ok','slow','redirect','bad','large','error','lost'].map(n=>[n,{path:'/'+n,method:'POST'}]));
 const host=createConnectorHost({api:{kind:'http',origin:`http://127.0.0.1:${server.address().port}`,token:'secret',operations}},{timeoutMs:80,maxBytes:1024});
 const call=(operation,input=null,signal)=>host.invoke(caller,{resource:'api',operation,input},signal);
 try{
 assert.deepEqual(await call('ok',{tenantId:'forged'}),{tenant:'a'});assert.equal(seen[0].authorization,'Bearer secret');assert.equal(seen[0].body.caller.tenantId,'a');
 await assert.rejects(call('https://evil.invalid'),denied('DENIED'));
 for(const op of ['redirect','error'])await assert.rejects(call(op),denied('UNAVAILABLE'));
 for(const op of ['bad','large'])await assert.rejects(call(op),denied('INVALID'));
 await assert.rejects(call('slow'),denied('TIMEOUT'));
 const controller=new AbortController();const pending=call('slow',null,controller.signal);setTimeout(()=>controller.abort(),10);await assert.rejects(pending,denied('CANCELLED'));
 await assert.rejects(call('lost',{write:'accepted'}),e=>e.code==='UNAVAILABLE'&&e.outcome==='unknown');
 assert.equal(seen.filter(x=>x.url==='/lost').length,1); // server accepted request; no automatic replay
 assert.ok(!seen.some(x=>x.url==='/secret'));
 await assert.rejects(host.transaction(caller,'api',[]),denied('INVALID'));
 }finally{await host.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
});

test('bounded admission rejects bursts without retaining arbitrary queue',async()=>{
 const db=await testDatabase();const pool=new pg.Pool({connectionString:db.connectionString,max:1,connectionTimeoutMillis:100});
 const host=createConnectorHost({db:{kind:'postgres',pool,operations:{slow:{text:'SELECT pg_sleep(1)',params:()=>[]}}}},{timeoutMs:80,maxActive:1});
 try{const one=host.invoke(caller,{resource:'db',operation:'slow',input:null});const rejected=assert.rejects(one,denied('TIMEOUT'));await assert.rejects(host.invoke(caller,{resource:'db',operation:'slow',input:null}),denied('UNAVAILABLE'));await rejected;}finally{await host.close();await db.cleanup();}
});
