/**
 * THE DOUBLES, shipped here because contracts are types only. A noop is an
 * EXPLICIT refusal ("service_unavailable"), never a silent empty result — a
 * chart drawn from silence is the failure the real caps exist to avoid.
 */
import type { Actor, BrowserService, QueryFailure, RenderResult, SqlService, TableResult } from '@artifactbin/contracts';

const UNAVAILABLE: QueryFailure = { error: 'service_unavailable' };

export function noopSql(): SqlService {
  return {
    run: async (i) => Object.fromEntries(i.queries.map((q) => [q.name, UNAVAILABLE])),
    mutate: async () => UNAVAILABLE,
    dryRun: async (i) => ({ errors: i.queries.map((q) => ({ name: q.name, ...UNAVAILABLE })), columns: {} }),
    dryRunMutations: async (i) => ({ errors: i.mutations.map((m) => ({ name: m.name, ...UNAVAILABLE })) }),
  };
}
export function noopBrowser(): BrowserService {
  return { render: async () => ({ ok: false, reason: 'unavailable' }) };
}

export interface FakeSql extends SqlService { calls: Array<{ method: keyof SqlService; input: unknown }> }
/** Fixtures by query name; anything else fails like an unknown table would. Dry-runs pass. */
export function fakeSql(fixtures: Record<string, TableResult>): FakeSql {
  const calls: FakeSql['calls'] = [];
  const rec = <K extends keyof SqlService>(method: K, fn: SqlService[K]): SqlService[K] => ((input: unknown) => { calls.push({ method, input }); return (fn as (i: unknown) => unknown)(input); }) as SqlService[K];
  return {
    calls,
    run: rec('run', async (i) => Object.fromEntries(i.queries.map((q) => [q.name, fixtures[q.name] ?? { error: `no fixture for ${q.name}` }]))),
    mutate: rec('mutate', async (i) => ({ ...(fixtures[i.table.name] ?? { rows: [], columns: i.table.columns }), affected: 0 })),
    dryRun: rec('dryRun', async (i) => ({ errors: [], columns: Object.fromEntries(i.queries.map((q) => [q.name, fixtures[q.name]?.columns ?? []])) })),
    dryRunMutations: rec('dryRunMutations', async () => ({ errors: [] })),
  };
}
export function fakeBrowser(result: RenderResult = { ok: true, mime: 'image/png', bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47]) }): BrowserService & { calls: unknown[] } {
  const calls: unknown[] = [];
  return { calls, render: async (r) => { calls.push(r); return result; } };
}
export const fakeActor = (partial: Partial<Actor> = {}): Actor => ({ credential: 'bearer', userId: 'usr_test', tokenId: 'tok_test', ...partial });
