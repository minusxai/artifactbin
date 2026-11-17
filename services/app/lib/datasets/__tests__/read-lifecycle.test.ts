/** Dataset hydration and cache misses share one read lifetime; signals reach the real worker. */
import {serveSql} from '@artifactbin/sql';
import {sqlClient} from '@artifactbin/utils';
import {QUERY_TIMEOUT_MS,SQL_READ_WALL_TIMEOUT_MS} from '@/lib/platform';
import { expect, it } from 'vitest';
import { createSql } from '@artifactbin/sql/local';
import type { SqlService } from '@artifactbin/contracts';
import { executeCatalog } from '../execute';
import type { DatasetCatalog } from '../types';

const catalog: DatasetCatalog = {kind:'stored',defaultSchema:'public',refreshSeconds:0,tables:[
  {schema:'public',name:'rows',columns:[{name:'n',type:'number'}],objectKey:'read-lifecycle-fixture'},
]};
const quick = {tables:{},params:{},queries:[{name:'warm',sql:'select 1'}]};

it.each(['local','http'])('%s passes cancellation through dataset execution and frees the single worker promptly', async transport => {
  const engine = createSql({timeoutMs:1200},{workers:1});
  const server=transport==='http'?serveSql(engine):undefined;
  const service=server?sqlClient(server.listen(0).url):engine;
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const objects={get:async()=>Buffer.from('[{"n":1}]')};
  try {
    await engine.run(quick);
    await executeCatalog(catalog,'select n from public.rows',{}, {view:null,execute:service.run,objects,timeoutMs:1200});
    const started = performance.now();
    timer = setTimeout(() => controller.abort(),70);
    await expect(executeCatalog(catalog,
      'with recursive c(n) as (select 1 union all select n+1 from c) select count(*) from c', {},
      {view:null,execute:service.run,objects,timeoutMs:1200,signal:controller.signal},
    )).rejects.toBeDefined();
    expect(controller.signal.aborted).toBe(true);
    expect(performance.now()-started).toBeLessThan(650);
    const resumed = performance.now();
    expect(await engine.run(quick)).toMatchObject({warm:{rows:[{'1':1}]}});
    expect(performance.now()-resumed).toBeLessThan(650);
  } finally { clearTimeout(timer); await server?.close(); await engine.close(); }
});

it('expires during hydration and never retries SQL after the shared wall budget has expired', async () => {
  const engine = createSql({timeoutMs:1200},{workers:1});
  let executions=0;
  const execute: SqlService['run'] = (...args) => { executions++; return engine.run(...args); };
  const objects = {get:async () => {await new Promise(resolve=>setTimeout(resolve,250));return Buffer.from('[{"n":1}]');}};
  const options: Parameters<typeof executeCatalog>[3] & {wallTimeoutMs:number} = {view:null,execute,objects,timeoutMs:1200,wallTimeoutMs:80};
  try {
    await engine.run(quick);
    const started = performance.now();
    await expect(executeCatalog(catalog,'select n from public.rows',{},options)).rejects.toBeDefined();
    expect(performance.now()-started).toBeLessThan(200);
    // A late object-store completion must not revive the expired SQL attempt.
    await new Promise(resolve=>setTimeout(resolve,300));
    expect(executions).toBe(1);
  } finally { await engine.close(); }
});

it('uses configured read defaults and integer remaining wall budgets on both cold attempts',async()=>{
 const calls:Array<{timeout?:number;wall?:number}>=[];
 const execute:SqlService['run']=async(input,context)=>{calls.push({timeout:input.timeoutMs,wall:context?.wallTimeoutMs});return calls.length===1?{result:{error:'rows required',rowsRequired:true}}:{result:{columns:[],rows:[]}};};
 await executeCatalog(catalog,'select 1',{}, {view:null,execute,objects:{get:async()=>Buffer.from('[]')}});
 expect(calls).toHaveLength(2);
 for(const call of calls){expect(call.timeout).toBe(QUERY_TIMEOUT_MS);expect(Number.isSafeInteger(call.wall)).toBe(true);expect(call.wall).toBeLessThanOrEqual(SQL_READ_WALL_TIMEOUT_MS);}
 expect(calls[1]!.wall).toBeLessThanOrEqual(calls[0]!.wall!);
});
it('rejects pre-aborted hydration without dispatching SQL',async()=>{
 let executions=0;
 await expect(executeCatalog(catalog,'select 1',{}, {view:null,signal:AbortSignal.abort(),execute:async()=>{executions++;return {};}})).rejects.toBeDefined();
 expect(executions).toBe(0);
});
it('checks the deadline after final authorization before releasing rows',async()=>{
 let checks=0;
 await expect(executeCatalog(catalog,'select 1',{}, {view:null,wallTimeoutMs:40,execute:async()=>({result:{columns:[],rows:[]}}),authorize:async()=>{if(++checks===2)await new Promise(resolve=>setTimeout(resolve,80));}})).rejects.toBeDefined();
 expect(checks).toBe(2);
});
it.each([0,-1,1.5,NaN,Infinity])('rejects malformed wall budget %s without dispatch',async wallTimeoutMs=>{
 let executions=0;
 await expect(executeCatalog(catalog,'select 1',{}, {view:null,wallTimeoutMs,execute:async()=>{executions++;return {};}})).rejects.toBeDefined();
 expect(executions).toBe(0);
});
