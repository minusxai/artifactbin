/** Read budgets include queueing; cancellation must reach the engine over either service transport. */
import http from 'node:http';
import { createSqliteSql } from '@artifactbin/sql/sqlite';
import { sqlCaps } from '../src/caps';
import { describe, expect, it } from 'vitest';
import { SQL_READ_LIMITS, type RunInput, type SqlService } from '@artifactbin/contracts';
import { serveSql } from '@artifactbin/sql';
import { createSql } from '@artifactbin/sql/local';
import { sqlClient } from '@artifactbin/utils';
import { DEFAULT_CAPS } from '../src/caps';

const QUICK: RunInput = { tables: {}, params: {}, queries: [{ name: 'q', sql: 'select 7 as n' }] };
const ENDLESS: RunInput = { tables: {}, params: {}, queries: [{ name: 'q', sql: 'with recursive c(n) as (select 1 union all select n+1 from c) select count(*) as n from c' }] };
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
  it('cancels actual work before the execution limit and makes the one-worker service usable again', async () => {
    const engine = createSql({ timeoutMs: 1200 }, { workers: 1 });
    const server = transport === 'http' ? serveSql(engine) : undefined;
    const service: ReadService = server ? sqlClient(server.listen(0).url, { deadlineMs: 3000 }) : engine;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      expect(await service.run(QUICK)).toMatchObject({ q: { rows: [{ n: 7 }] } });
      const start = performance.now();
      timer = setTimeout(() => controller.abort(), 70);
      const answer = await service.run(ENDLESS, { signal: controller.signal });
      expect(answer.q).toHaveProperty('error');
      expect(performance.now() - start).toBeLessThan(650);
      const resumed = performance.now();
      expect(await service.run(QUICK)).toMatchObject({ q: { rows: [{ n: 7 }] } });
      expect(performance.now() - resumed).toBeLessThan(650);
    } finally { clearTimeout(timer); await server?.close(); await engine.close(); }
  });

  it('expires a queued read without waiting for the busy worker or dispatching the expired work', async () => {
    const engine = createSql({ timeoutMs: 1200 }, { workers: 1 });
    const server = transport === 'http' ? serveSql(engine) : undefined;
    const service: ReadService = server ? sqlClient(server.listen(0).url, { deadlineMs: 3000 }) : engine;
    let busy: ReturnType<SqlService['run']> | undefined;
    try {
      await service.run(QUICK);
      busy = service.run(ENDLESS);
      // Warmed single worker is occupied before this second request reaches the service.
      await new Promise(resolve => setTimeout(resolve, 60));
      const start = performance.now();
      const answer = await service.run(QUICK, { wallTimeoutMs: 100 });
      expect(answer.q).toMatchObject({ timedOut: true });
      expect(performance.now() - start).toBeLessThan(650);
    } finally { await busy; await server?.close(); await engine.close(); }
  });
});

describe.each(['local', 'http'] as const)('%s batch and admission regressions', transport => {
  async function fixture(test: (svc: SqlService, engine: ReturnType<typeof createSql>) => Promise<void>) {
    const engine = createSql({timeoutMs: 1000}, {workers:1});
    const server = transport === 'http' ? serveSql(engine) : undefined;
    const svc = server ? sqlClient(server.listen(0).url) : engine;
    try { await svc.run(QUICK); await test(svc, engine); }
    finally { await server?.close(); await engine.close(); }
  }
  it('rejects pre-aborted reads and batches without consuming the worker', () => fixture(async svc => {
    const signal = AbortSignal.abort();
    expect(await svc.run(ENDLESS, {signal})).toMatchObject({q:{error:'SQL call cancelled'}});
    expect(await svc.runMany({runs:[ENDLESS]}, {signal})).toMatchObject([{q:{error:'SQL call cancelled'}}]);
    expect(await svc.run(QUICK)).toMatchObject({q:{rows:[{n:7}]}});
  }));
  it('cancels a running batch and does not retry individual statements', () => fixture(async svc => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 50);
    try {
      const start = performance.now();
      const result = await svc.runMany({shared:QUICK,runs:[ENDLESS,ENDLESS]}, {signal:controller.signal});
      expect(result).toMatchObject([{q:{error:'SQL call cancelled'}},{q:{error:'SQL call cancelled'}}]);
      expect(performance.now()-start).toBeLessThan(650);
      const resumed = performance.now();
      expect(await svc.run(QUICK)).toMatchObject({q:{rows:[{n:7}]}});
      expect(performance.now()-resumed).toBeLessThan(650);
    } finally { clearTimeout(timer); }
  }));
  it('bounds the whole batch rather than renewing each statement deadline', () => fixture(async svc => {
    const start = performance.now();
    const result = await svc.runMany({runs:[ENDLESS,ENDLESS]}, {wallTimeoutMs:80});
    expect(result).toMatchObject([{q:{timedOut:true}},{q:{timedOut:true}}]);
    expect(performance.now()-start).toBeLessThan(650);
  }));
  it('removes an aborted queued batch while the active call remains usable', () => fixture(async svc => {
    const busyController = new AbortController();
    const busy = svc.run(ENDLESS, {signal:busyController.signal});
    await new Promise(resolve => setTimeout(resolve, 40));
    const controller = new AbortController();
    const queued = svc.runMany({runs:[QUICK]}, {signal:controller.signal});
    controller.abort();
    expect(await queued).toMatchObject([{q:{error:'SQL call cancelled'}}]);
    busyController.abort(); await busy;
    expect(await svc.run(QUICK)).toMatchObject({q:{rows:[{n:7}]}});
  }));
});

it('shutdown settles queued and active reads and refuses later work', async () => {
  const engine = createSql({timeoutMs:1000}, {workers:1});
  await engine.run(QUICK);
  const active = engine.run(ENDLESS);
  const queued = engine.runMany({runs:[QUICK]});
  await engine.close();
  expect(await active).toMatchObject({q:{error:'the SQL engine is closed'}});
  expect(await queued).toMatchObject([{q:{error:'the SQL engine is closed'}}]);
  expect(await engine.run(QUICK)).toMatchObject({q:{error:'the SQL engine is closed'}});
});

it('preserves default and explicitly configured mutation caps separately from reads', async () => {
  expect(DEFAULT_CAPS.mutationTimeoutMs).toBe(5000);
  expect(sqlCaps({})).toMatchObject({timeoutMs:30000, mutationTimeoutMs:5000});
  expect(sqlCaps({timeoutMs:7000})).toMatchObject({timeoutMs:7000, mutationTimeoutMs:7000});
  const engine = createSql({timeoutMs:1000, mutationTimeoutMs:60}, {workers:1});
  try {
    await engine.run(QUICK);
    const start = performance.now();
    const result = await engine.mutate({table:{name:'t',rows:[{n:1}],columns:[{name:'n',type:'number'}]}, params:{},
      sql:'update t set n = (with recursive c(n) as (select 1 union all select n+1 from c) select count(*) from c)'});
    expect(result).toMatchObject({timedOut:true});
    expect(performance.now()-start).toBeLessThan(650);
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
        expect(await svc.runMany({runs:[QUICK]}, {wallTimeoutMs:value})).toMatchObject([{q:{error:expect.any(String)}}]);
      }
      const start = performance.now();
      expect(await svc.run({...ENDLESS,timeoutMs:1000000}, {wallTimeoutMs:1000000})).toMatchObject({q:{timedOut:true}});
      expect(performance.now()-start).toBeLessThan(650);
      expect(await svc.run({...QUICK,limit:Infinity})).toMatchObject({q:{rows:[{n:7}]}});
    } finally { await server?.close(); await engine.close(); }
  });
});

it('never falls back to run after a failed HTTP batch', async () => {
  const engine = createSql({timeoutMs:1000}, {workers:1});
  let runs = 0, batches = 0;
  const server = serveSql({...engine,
    run: async (...args) => { runs++; return engine.run(...args); },
    runMany: async (...args) => { batches++; return engine.runMany(...args); },
  });
  const svc = sqlClient(server.listen(0).url);
  try {
    await svc.run(QUICK); runs = 0;
    expect(await svc.runMany({runs:[ENDLESS,ENDLESS]}, {wallTimeoutMs:80})).toMatchObject([{q:{timedOut:true}},{q:{timedOut:true}}]);
    await new Promise(resolve => setTimeout(resolve, 30));
    expect({runs,batches}).toEqual({runs:0,batches:1});
    const controller = new AbortController(); controller.abort(new Error('private abort reason'));
    expect(await svc.run(QUICK,{signal:controller.signal})).toMatchObject({q:{error:'SQL call cancelled'}});
  } finally { await server.close(); await engine.close(); }
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

it('bounds synchronous batches at statement boundaries and honors pre-abort without claiming mid-call abort', async () => {
  const engine = createSqliteSql({timeoutMs:1000});
  await engine.run(QUICK);
  expect(await engine.run(ENDLESS,{signal:AbortSignal.abort()})).toMatchObject({q:{error:'SQL call cancelled'}});
  const start = performance.now();
  expect(await engine.runMany({runs:[ENDLESS,ENDLESS]}, {wallTimeoutMs:70})).toMatchObject([{q:{timedOut:true}},{q:{timedOut:true}}]);
  expect(performance.now()-start).toBeLessThan(650);
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
      guard = setTimeout(() => reject(new Error('unfinished upload exceeded its deadline')), 600);
    });
    expect(status).toBe(408);
    expect(dispatched).toBe(0);
  } finally { clearTimeout(guard); request?.destroy(); await server.close(); await engine.close(); }
});
