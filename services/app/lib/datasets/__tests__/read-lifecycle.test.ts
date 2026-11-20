/** Dataset hydration and cache misses share one read lifetime; signals reach the real worker. */
import {serveSql} from '@artifactbin/sql';
import {sqlClient} from '@artifactbin/utils';
import {QUERY_TIMEOUT_MS,SQL_READ_WALL_TIMEOUT_MS} from '@/lib/platform';
import { expect, it, vi } from 'vitest';
import { createSql } from '@artifactbin/sql/local';
import type { SqlService } from '@artifactbin/contracts/sql';
import { executeCatalog } from '../execute';
import type { DatasetCatalog } from '../types';

const catalog: DatasetCatalog = {kind:'stored',defaultSchema:'public',refreshSeconds:0,tables:[
  {schema:'public',name:'rows',columns:[{name:'n',type:'number'}],objectKey:'read-lifecycle-fixture'},
]};
const quick = {tables:{},params:{},queries:[{name:'warm',sql:'select 1'}]};

/** What one engine answer was: a cache miss that asks for rows, rows, or the failure's own words. */
const kind = (answer: unknown) => {
  const q = answer as {rowsRequired?: boolean; timedOut?: boolean; error?: string};
  return q.rowsRequired ? 'rowsRequired' : q.timedOut ? 'timedOut' : q.error ?? 'rows';
};

// The claims are outcomes, not a sub-second clock: the engine answers "cancelled" (never its execution limit), and the
// one worker is replaced (its prepared database is gone, so the next read asks for rows) and answers. The only clocks
// sit far under the 3000 ms limit a missed cancellation would run to: respawning the worker under tsx took ~130 ms
// locally and 890 ms on a loaded runner, which failed a 650 ms bound on main.
it.each(['local','http'])('%s passes cancellation through dataset execution to the engine and replaces the single worker', async transport => {
  const engine = createSql({timeoutMs:3000},{workers:1});
  const server=transport==='http'?serveSql(engine):undefined;
  const service=server?sqlClient(server.listen(0).url,{deadlineMs:6000}):engine;
  const answers: string[] = [];
  const execute: SqlService['run'] = async (input, context) => { const answer = await service.run(input, context); answers.push(kind(answer.result)); return answer; };
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const objects={get:async()=>Buffer.from('[{"n":1}]')};
  const read = (opts: {signal?: AbortSignal; wallTimeoutMs?: number} = {}, sql = 'select n from public.rows') =>
    executeCatalog(catalog,sql,{}, {view:null,execute,objects,timeoutMs:3000,...opts});
  try {
    await engine.run(quick);
    await read();
    expect(answers, 'a cold read asks for rows, then answers').toEqual(['rowsRequired','rows']);
    answers.length = 0;
    await read();
    expect(answers, 'the worker kept the prepared database: the key alone answers').toEqual(['rows']);
    answers.length = 0;
    const started = performance.now();
    let aborted = 0;
    timer = setTimeout(() => { aborted = performance.now(); controller.abort(); },70);
    await expect(read({signal:controller.signal},'with recursive c(n) as (select 1 union all select n+1 from c) select count(*) from c')).rejects.toBeDefined();
    const answered = performance.now();
    const phases = `abort timer fired at +${Math.round(aborted - started)} ms (set for 70), rejected at +${Math.round(answered - started)} ms`;
    expect(controller.signal.aborted).toBe(true);
    expect(answers, `${phases}: the engine answered`).toEqual(['SQL call cancelled']);
    expect(answered - started, phases).toBeLessThan(1500);
    answers.length = 0;
    const resumed = performance.now();
    // A worker still running the cancelled statement holds the next read past its 1500 ms wall: it fails, never hangs.
    expect((await read({wallTimeoutMs:1500})).rows).toEqual([{n:1}]);
    expect(answers, `${phases}; the next read took ${Math.round(performance.now() - resumed)} ms on a fresh worker`).toEqual(['rowsRequired','rows']);
  } finally { clearTimeout(timer); await server?.close(); await engine.close(); }
});

it('expires during hydration and never retries SQL after the shared wall budget has expired', async () => {
  const engine = createSql({timeoutMs:3000},{workers:1});
  let executions=0;
  const execute: SqlService['run'] = (...args) => { executions++; return engine.run(...args); };
  // The object store answers only when the test releases it, after the read has expired: expiry during hydration is
  // an ordering, not a race between a sleep and the wall budget.
  let hydrating=false, release!: () => void;
  const stored = new Promise<void>(resolve => { release = resolve; });
  const objects = {get:async () => {hydrating=true;await stored;return Buffer.from('[{"n":1}]');}};
  const options: Parameters<typeof executeCatalog>[3] & {wallTimeoutMs:number} = {view:null,execute,objects,timeoutMs:3000,wallTimeoutMs:500};
  let guard: ReturnType<typeof setTimeout> | undefined;
  try {
    await engine.run(quick);
    const expired = executeCatalog(catalog,'select n from public.rows',{},options).then(() => 'answered', () => 'rejected');
    const hung = new Promise(resolve => { guard = setTimeout(() => resolve('still waiting for hydration 5 s past its 500 ms wall budget'), 5000); });
    expect(await Promise.race([expired, hung])).toBe('rejected');
    expect(hydrating, 'the read expired while the object store was still answering').toBe(true);
    // A late object-store completion must not revive the expired SQL attempt.
    release();
    await new Promise(resolve => setImmediate(resolve));
    expect(executions).toBe(1);
  } finally { clearTimeout(guard); release(); await engine.close(); }
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
 // The final authorization is where the wall budget runs out: the clock jumps past it there, and nowhere sooner.
 const now=performance.now.bind(performance);let skew=0;
 const clock=vi.spyOn(performance,'now').mockImplementation(()=>now()+skew);
 let checks=0;
 try{
  await expect(executeCatalog(catalog,'select 1',{}, {view:null,wallTimeoutMs:10_000,execute:async()=>({result:{columns:[],rows:[]}}),authorize:async()=>{if(++checks===2)skew=60_000;}})).rejects.toBeDefined();
  expect(checks).toBe(2);
 }finally{clock.mockRestore();}
});
it.each([0,-1,1.5,NaN,Infinity])('rejects malformed wall budget %s without dispatch',async wallTimeoutMs=>{
 let executions=0;
 await expect(executeCatalog(catalog,'select 1',{}, {view:null,wallTimeoutMs,execute:async()=>{executions++;return {};}})).rejects.toBeDefined();
 expect(executions).toBe(0);
});

// pr fast budget probe: an edit of many node test files (closed unmerged)
