/** Read budgets include queueing; cancellation must reach the engine over either service transport. */
import http from 'node:http';
import { createSqliteSql } from '@artifactbin/sql/testing';
import { sqlCaps } from '../src/caps';
import { describe, expect, it } from 'vitest';
import { SQL_READ_LIMITS, type RunInput, type SqlService } from '@artifactbin/contracts/sql';
import { SERVICE_AUTH_HEADER } from '@artifactbin/contracts/routes';
import { serveSql } from '@artifactbin/sql';
import { createSql } from '@artifactbin/sql/local';
import { sqlClient } from '@artifactbin/utils';
import { DEFAULT_CAPS } from '../src/caps';

const QUICK: RunInput = { tables: {}, params: {}, queries: [{ name: 'q', sql: 'select 7 as n' }] };
const ENDLESS: RunInput = { tables: {}, params: {}, queries: [{ name: 'q', sql: 'with recursive c(n) as (select 1 union all select n+1 from c) select count(*) as n from c' }] };
// The claims below are outcomes and orderings, not a sub-second clock: a cancelled call answers "cancelled", the worker that
// ran it is replaced and answers the next read, a queued read expires while the busy one still runs. Where elapsed time is
// the claim (a whole-call budget, a clamped limit) the engine limit a broken path would run to is 3000 ms and the bound
// 1500, with the phases in the message: a respawned worker under tsx took 772-890 ms on a loaded runner, past 650.
const columns = [{ name: 'n', type: 'number' as const }];
/** A keyed catalog read (src/sqlite/prepared.ts): `rows: false` sends the key alone, answered only by a worker that prepared it. */
const keyed = (rows: boolean): RunInput => ({
  catalog: { defaultSchema: 'public', tables: [{ schema: 'public', name: 'rows', columns, source: 't', key: 'read-deadline' }] },
  tables: rows ? { t: { rows: [{ n: 1 }, { n: 2 }], columns } } : {}, queries: [{ name: 'q', sql: 'select sum(n) as total from rows' }], params: {},
});
/** Prepares the keyed database on the one worker; until that worker is replaced the key alone answers. */
async function prepare(svc: ReadService) {
  expect((await svc.run(keyed(true))).q).toMatchObject({ rows: [{ total: 3 }] });
  expect((await svc.run(keyed(false))).q, 'the worker kept the prepared database').toMatchObject({ rows: [{ total: 3 }] });
}
/**
 * The worker that ran the cancelled work was terminated and a fresh one answers: it never prepared the key, so it asks for
 * the rows. A worker still busy with the cancelled statement would hold this read past its 1500 ms wall (`timedOut`).
 */
async function expectReplaced(svc: ReadService, phases: string) {
  const resumed = performance.now();
  const next = (await svc.run(keyed(false), { wallTimeoutMs: 1500 })).q;
  expect(next, `${phases}; the next read answered after ${Math.round(performance.now() - resumed)} ms`).toMatchObject({ rowsRequired: true });
  expect((await svc.run(keyed(true))).q).toMatchObject({ rows: [{ total: 3 }] });
}
it('reports the actual engine read policy only through the protected service door',async()=>{
  const engine=createSql({timeoutMs:7000}),server=serveSql(engine,{serviceSecret:'synthetic_policy_secret'});
  const url=server.listen(0).url+'/read-policy';
  try{
    expect((await fetch(url,{method:'POST',body:'{}'})).status).toBe(401);
    const response=await fetch(url,{method:'POST',body:'{}',headers:{[SERVICE_AUTH_HEADER]:'synthetic_policy_secret'}});
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({version:1,queryTimeoutMs:7000});
  }finally{await server.close();await engine.close();}
});
// The second argument is trusted process-local call context, never part of the serialized SQL payload.
type ReadService = { run(input: RunInput, context?: { signal?: AbortSignal; wallTimeoutMs?: number }): ReturnType<SqlService['run']> };

it('gives reads a 30-second default and a finite 45-second default envelope', () => {
  expect(DEFAULT_CAPS.timeoutMs).toBe(30_000);
  expect(SQL_READ_LIMITS.timeoutMs).toBe(30_000);
  expect(SQL_READ_LIMITS.wallMs).toBe(45_000);
});

it.each([0, -1, 1.5, NaN, Infinity, 120_001])('rejects invalid operator read timeout %s', async timeoutMs => {
  let service: ReturnType<typeof createSql> | undefined;
  try { expect(() => { service = createSql({ timeoutMs }); }).toThrow(); }
  finally { await service?.close(); }
});

describe.each(['local', 'http'] as const)('%s SQL read lifecycle', transport => {
  it('cancels actual work before the execution limit and replaces the one worker, which answers the next read', async () => {
    const engine = createSql({ timeoutMs: 3000 }, { workers: 1 });
    const server = transport === 'http' ? serveSql(engine) : undefined;
    const service: ReadService = server ? sqlClient(server.listen(0).url, { deadlineMs: 6000 }) : engine;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await prepare(service);
      const start = performance.now();
      let aborted = 0;
      timer = setTimeout(() => { aborted = performance.now(); controller.abort(); }, 70);
      const answer = await service.run(ENDLESS, { signal: controller.signal });
      const answered = performance.now();
      // Each phase in the message: a slow run names its step (the abort timer firing late, or the answer after it).
      const phases = `abort timer fired at +${Math.round(aborted - start)} ms (set for 70), answer at +${Math.round(answered - start)} ms`;
      expect(answer.q, phases).toEqual({ error: 'SQL call cancelled' });
      expect(answered - start, phases).toBeLessThan(1500);
      await expectReplaced(service, phases);
    } finally { clearTimeout(timer); await server?.close(); await engine.close(); }
  });

  it('expires a queued read without waiting for the busy worker or dispatching the expired work', async () => {
    const engine = createSql({ timeoutMs: 3000 }, { workers: 1 });
    const server = transport === 'http' ? serveSql(engine) : undefined;
    const service: ReadService = server ? sqlClient(server.listen(0).url, { deadlineMs: 6000 }) : engine;
    const busyController = new AbortController();
    let busy: Promise<unknown> | undefined, busySettled = false;
    try {
      await service.run(QUICK);
      busy = service.run(ENDLESS, { signal: busyController.signal }).finally(() => { busySettled = true; });
      // Warmed single worker is occupied before this second request reaches the service.
      await new Promise(resolve => setTimeout(resolve, 150));
      const start = performance.now();
      const answer = await service.run(QUICK, { wallTimeoutMs: 100 });
      const phases = `the queued read answered after ${Math.round(performance.now() - start)} ms`;
      // A queued read that waited for the worker would also answer timed out (the pool expires a late answer), so the
      // claim is the order: it answers while the busy read still holds the worker, which runs to 3000 ms unless aborted.
      expect(busySettled, `${phases}, after the busy read: it waited for the worker`).toBe(false);
      expect(answer.q, phases).toMatchObject({ timedOut: true });
      expect(performance.now() - start, phases).toBeLessThan(1500);
    } finally { busyController.abort(); await busy; await server?.close(); await engine.close(); }
  });
});

describe.each(['local', 'http'] as const)('%s read admission regressions', transport => {
  async function fixture(test: (svc: SqlService) => Promise<void>) {
    const engine = createSql({timeoutMs: 3000}, {workers:1});
    const server = transport === 'http' ? serveSql(engine) : undefined;
    const svc = server ? sqlClient(server.listen(0).url, {deadlineMs: 6000}) : engine;
    try { await svc.run(QUICK); await test(svc); }
    finally { await server?.close(); await engine.close(); }
  }
  it('rejects pre-aborted reads without consuming the worker', () => fixture(async svc => {
    const signal = AbortSignal.abort(new Error('private abort reason'));
    expect(await svc.run(ENDLESS, {signal})).toMatchObject({q:{error:'SQL call cancelled'}});
    expect(await svc.run(QUICK)).toMatchObject({q:{rows:[{n:7}]}});
  }));
  it('removes an aborted queued read while the active call remains usable', () => fixture(async svc => {
    const busyController = new AbortController();
    const busy = svc.run(ENDLESS, {signal:busyController.signal});
    await new Promise(resolve => setTimeout(resolve, 40));
    const controller = new AbortController();
    const queued = svc.run(QUICK, {signal:controller.signal});
    controller.abort();
    expect(await queued).toMatchObject({q:{error:'SQL call cancelled'}});
    busyController.abort(); await busy;
    expect(await svc.run(QUICK)).toMatchObject({q:{rows:[{n:7}]}});
  }));
});

it('shutdown settles queued and active reads and refuses later work', async () => {
  const engine = createSql({timeoutMs:1000}, {workers:1});
  await engine.run(QUICK);
  const active = engine.run(ENDLESS);
  const queued = engine.run(QUICK);
  await engine.close();
  expect(await active).toMatchObject({q:{error:'the SQL engine is closed'}});
  expect(await queued).toMatchObject({q:{error:'the SQL engine is closed'}});
  expect(await engine.run(QUICK)).toMatchObject({q:{error:'the SQL engine is closed'}});
});

it('keeps the mutation cap separate from the read cap', async () => {
  expect(DEFAULT_CAPS.mutationTimeoutMs).toBe(5000);
  expect(sqlCaps({})).toMatchObject({timeoutMs:30000, mutationTimeoutMs:5000});
  expect(sqlCaps({timeoutMs:7000})).toMatchObject({timeoutMs:7000, mutationTimeoutMs:5000});
  const engine = createSql({timeoutMs:3000, mutationTimeoutMs:60}, {workers:1});
  try {
    await engine.run(QUICK);
    const start = performance.now();
    const result = await engine.mutate({table:{name:'t',rows:[{n:1}],columns:[{name:'n',type:'number'}]}, params:{},
      sql:'update t set n = (with recursive c(n) as (select 1 union all select n+1 from c) select count(*) from c)'});
    const phases = `the mutation answered after ${Math.round(performance.now() - start)} ms`;
    // Under the 3000 ms read cap it would run 3000 ms: the 60 ms mutation cap is the one named and the one enforced.
    expect(result, phases).toMatchObject({timedOut:true, error:expect.stringContaining('(limit 60ms)')});
    expect(performance.now()-start, phases).toBeLessThan(1500);
  } finally { await engine.close(); }
});

describe.each(['local','http'] as const)('%s request budgets', transport => {
  it('rejects invalid values and clamps valid larger values, preserving row behavior', async () => {
    const engine = createSql({timeoutMs:80}, {workers:1});
    const server = transport === 'http' ? serveSql(engine) : undefined;
    const svc = server ? sqlClient(server.listen(0).url) : engine;
    try {
      await svc.run(QUICK);
      for (const value of [0,-1,1.5,NaN,Infinity,Number.MAX_SAFE_INTEGER+1]) {
        expect(await svc.run({...QUICK,timeoutMs:value})).toHaveProperty('q.error');
        expect(await svc.run(QUICK, {wallTimeoutMs:value})).toHaveProperty('q.error');
      }
      // Unclamped, the read would run for 1000 s: it is clamped to the engine's 80 ms, which its answer names.
      const start = performance.now();
      const clamped = await svc.run({...ENDLESS,timeoutMs:1000000}, {wallTimeoutMs:1000000});
      const phases = `the clamped read answered after ${Math.round(performance.now() - start)} ms`;
      expect(clamped, phases).toMatchObject({q:{timedOut:true, error:expect.stringContaining('(limit 80ms)')}});
      expect(performance.now()-start, phases).toBeLessThan(1500);
      expect(await svc.run({...QUICK,limit:Infinity})).toMatchObject({q:{rows:[{n:7}]}});
    } finally { await server?.close(); await engine.close(); }
  });
});

it('accounts for HTTP body admission before dispatching SQL', async () => {
  const engine = createSql();
  let dispatched = 0;
  const server = serveSql({...engine, run: async (...args) => { dispatched++; return engine.run(...args); }});
  const {url} = server.listen(0);
  try {
    const status = await new Promise<number | undefined>((resolve, reject) => {
      const request = http.request(`${url}/run`, {method:'POST',headers:{'x-sql-wall-timeout-ms':'20'}}, response => {
        response.resume(); response.on('end', () => resolve(response.statusCode));
      });
      request.on('error', reject);
      request.write(' ');
      setTimeout(() => request.end(JSON.stringify(QUICK)), 60);
    });
    expect(status).toBe(408);
    expect(dispatched).toBe(0);
  } finally { await server.close(); await engine.close(); }
});

it('bounds synchronous reads at statement boundaries and honors pre-abort without claiming mid-call abort', async () => {
  const engine = createSqliteSql({timeoutMs:3000});
  await engine.run(QUICK);
  expect(await engine.run(ENDLESS,{signal:AbortSignal.abort()})).toMatchObject({q:{error:'SQL call cancelled'}});
  // Each statement under its own 3000 ms limit would take 6000 ms; the 70 ms wall bounds both.
  const start = performance.now();
  const answer = await engine.run({...ENDLESS, queries:[ENDLESS.queries[0]!, {...ENDLESS.queries[0]!, name:'q2'}]}, {wallTimeoutMs:70});
  const phases = `the 70 ms read answered after ${Math.round(performance.now() - start)} ms`;
  expect(answer, phases).toMatchObject({q:{timedOut:true},q2:{timedOut:true}});
  expect(performance.now()-start, phases).toBeLessThan(1500);
});

it('expires an unfinished SQL upload at its admission deadline without dispatching work', async () => {
  const engine = createSql();
  let dispatched = 0;
  const server = serveSql({...engine, run: async (...args) => { dispatched++; return engine.run(...args); }});
  const {url} = server.listen(0);
  let request: ReturnType<typeof http.request> | undefined;
  let guard: ReturnType<typeof setTimeout> | undefined;
  try {
    const status = await new Promise<number | undefined>((resolve, reject) => {
      request = http.request(`${url}/run`, {method:'POST',headers:{'x-sql-wall-timeout-ms':'30'}}, response => {
        response.resume(); response.on('end', () => resolve(response.statusCode));
      });
      request.on('error', reject);
      request.write(' ');
      // Never finished, the upload would hang: the guard only names that, far past the 30 ms admission deadline.
      guard = setTimeout(() => reject(new Error('unfinished upload exceeded its deadline')), 1500);
    });
    expect(status).toBe(408);
    expect(dispatched).toBe(0);
  } finally { clearTimeout(guard); request?.destroy(); await server.close(); await engine.close(); }
});
