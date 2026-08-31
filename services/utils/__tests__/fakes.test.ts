/** The doubles ship with utils because contracts are types only. A noop is an explicit refusal, never a silent empty. */
import { describe, expect, it } from 'vitest';
import { isQueryFailure } from '@artifactbin/contracts';
import { fakeSql, noopBrowser, noopSql } from '@artifactbin/utils';

describe('noops', () => {
  it('sql answers a failure per query, and refuses a dry-run', async () => {
    const r = await noopSql().run({ tables: {}, queries: [{ name: 'q', sql: 'select 1' }], params: {} });
    expect(isQueryFailure(r.q) && r.q.error).toBe('service_unavailable');
    expect((await noopSql().dryRun({ tables: {}, queries: [{ name: 'q', sql: 'select 1' }], paramNames: [] })).errors[0]?.error).toBe('service_unavailable');
  });
  it('browser answers unavailable', async () => {
    expect(await noopBrowser().render({ url: 'http://x', format: 'png', viewport: { width: 1, height: 1 }, selector: 'body', capture: 'full' })).toEqual({ ok: false, reason: 'unavailable' });
  });
  it('fakeSql serves fixtures by query name and records what it was asked', async () => {
    const f = fakeSql({ q: { rows: [{ a: 1 }], columns: [{ name: 'a', type: 'number' }] } });
    const r = await f.run({ tables: {}, queries: [{ name: 'q', sql: 'select 1' }, { name: 'zz', sql: 'x' }], params: {} });
    expect(r.q).toEqual({ rows: [{ a: 1 }], columns: [{ name: 'a', type: 'number' }] });
    expect(isQueryFailure(r.zz)).toBe(true);
    expect(f.calls.map((c) => c.method)).toEqual(['run']);
  });
});
