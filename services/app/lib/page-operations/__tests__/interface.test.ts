import { afterEach, describe, expect, it } from 'vitest';
import type { RunStart, RunnerService } from '@artifactbin/contracts';
import { mintAccountToken, request, useAppHarness } from '@/__tests__/harness';
import { getDb, services, setServices } from '@/lib/platform';
import { backendSecrets } from '@/lib/html-backend-secrets';
import { POST as create } from '@/app/api/artifacts/route';
import { FIELD_ERROR_CODE, FieldFailed, compilePageBackend, localPageBackendCapability } from '..';

useAppHarness();
const original = services().runner;
afterEach(() => setServices({ runner: original }));

function fakeRunner(output: unknown, started: RunStart[] = []): RunnerService {
  return {
    start: async (run: RunStart) => { started.push(run); return { runId: 'run_1' }; },
    getRun: async () => ({ status: 'completed', output }),
    cancel: async () => {},
  } as unknown as RunnerService;
}

describe('FIELD_ERROR_CODE', () => {
  it('admits short lower-case snake codes only', () => {
    for (const code of ['a', 'store_limit', 'x'.repeat(64)]) expect(FIELD_ERROR_CODE.test(code)).toBe(true);
    for (const code of ['', '_lead', 'Upper', 'with-dash', 'digit1', 'x'.repeat(65), 'ü', 'two words']) expect(FIELD_ERROR_CODE.test(code)).toBe(false);
  });

  it('is the code a FieldFailed carries through to extensions', () => {
    expect(new FieldFailed('backend_failed').code).toMatch(FIELD_ERROR_CODE);
  });
});

describe('compilePageBackend', () => {
  it('compiles through the configured runner as a schema run and answers sorted secret bindings', async () => {
    const started: RunStart[] = [];
    setServices({ runner: fakeRunner({ typeDefs: 'type Query { count: Int! }', secretBindings: ['ZED', 'API_TOKEN'] }, started) });
    const compiled = await compilePageBackend('export const typeDefs = "type Query { count: Int! }"; export default { count: () => 1 };');
    expect(compiled.typeDefs).toBe('type Query { count: Int! }');
    expect(compiled.secretBindings).toEqual(['API_TOKEN', 'ZED']);
    expect(started).toHaveLength(1);
    expect(started[0]!.input).toEqual({ kind: 'schema' });
    expect(started[0]!.program.source).toBe(compiled.compiled);
  });

  it('refuses an oversized source before reaching the runner', async () => {
    const started: RunStart[] = [];
    setServices({ runner: fakeRunner({ typeDefs: 'type Query { a: Int }' }, started) });
    await expect(compilePageBackend('x'.repeat(262_145))).rejects.toMatchObject({ code: 'source_limit' });
    expect(started).toEqual([]);
  });

  it('refuses a backend whose exports carry no schema, or declare malformed secret names', async () => {
    setServices({ runner: fakeRunner({ nothing: true }) });
    await expect(compilePageBackend('export default {}')).rejects.toThrow('invalid_backend_exports');
    setServices({ runner: fakeRunner(['not', 'an', 'object']) });
    await expect(compilePageBackend('export default {}')).rejects.toThrow('invalid_backend_exports');
    setServices({ runner: fakeRunner({ typeDefs: 'type Query { a: Int }', secretBindings: ['lower'] }) });
    await expect(compilePageBackend('export default {}')).rejects.toThrow('invalid_secret_bindings');
  });

  it('stops at once when the caller has already cancelled', async () => {
    setServices({ runner: fakeRunner({ typeDefs: 'type Query { a: Int }' }) });
    const aborted = new AbortController(); aborted.abort();
    await expect(compilePageBackend('export default {}', aborted.signal)).rejects.toMatchObject({ code: 'cancelled' });
  });
});

describe('localPageBackendCapability', () => {
  async function backend() {
    const owner = await mintAccountToken('capability-owner');
    const made = await create(request('/api/artifacts', { method: 'POST', token: owner.token, json: { html: '<!doctype html><html><head></head><body><p>x</p></body></html>' } }));
    const pageId = (await made.json() as { id: string }).id;
    const db = await getDb();
    await db.query("INSERT INTO html_backend_versions (backend_id, version, page_id, name, source, type_defs, compiled, owner_id, secret_bindings) VALUES ('be_1', 'v1', $1, 'tasks', 'src', 'type Query { a: Int }', 'compiled-program', $2, '[\"API_TOKEN\"]'::jsonb)", [pageId, owner.userId]);
    await db.query("INSERT INTO html_backend_stores (backend_id, value, version) VALUES ('be_1', '{\"count\":3}'::jsonb, 4)");
    await backendSecrets.put({ ownerId: owner.userId!, backendId: 'be_1' }, 'API_TOKEN', 'secret-value');
    const run: RunStart = { requestId: 'req', pageBackendOperation: 'query', userId: owner.userId!, artifactId: 'be_1', artifactVersion: 'v1', program: { source: 'compiled-program', language: 'javascript' }, input: { kind: 'invoke', principal: { tenant: pageId, subject: null } } } as RunStart;
    return { owner, pageId, run };
  }

  it('reads the pinned backend store and its declared secret', async () => {
    const { run } = await backend();
    expect(await localPageBackendCapability(run, 'artifactbin.pageBackend.store.get', null)).toEqual({ value: { count: 3 }, version: 4 });
    expect(await localPageBackendCapability(run, 'artifactbin.pageBackend.secrets.get', { name: 'API_TOKEN' })).toBe('secret-value');
    await expect(localPageBackendCapability(run, 'artifactbin.pageBackend.secrets.get', { name: 'UNDECLARED' })).rejects.toThrow('backend_secret_forbidden');
  });

  it('refuses a run that does not match the stored backend: other owner, other program, other tenant or no invoke input', async () => {
    const { run } = await backend();
    for (const bad of [
      { ...run, userId: 'someone_else' },
      { ...run, program: { ...run.program, source: 'changed' } },
      { ...run, input: { kind: 'invoke', principal: { tenant: 'other_page', subject: null } } },
      { ...run, artifactVersion: 'v2' },
      { ...run, input: { kind: 'schema' } },
      { ...run, artifactId: undefined },
    ]) await expect(localPageBackendCapability(bad as RunStart, 'artifactbin.pageBackend.store.get', null)).rejects.toThrow('backend_capability_forbidden');
  });

  it('writes the store only from a mutation, within the size limit, and only at the expected version', async () => {
    const { run } = await backend();
    await expect(localPageBackendCapability(run, 'artifactbin.pageBackend.store.set', { expected: 4, value: 1 })).rejects.toThrow('backend_capability_forbidden');
    const mutation = { ...run, pageBackendOperation: 'mutation' } as RunStart;
    await expect(localPageBackendCapability(mutation, 'artifactbin.pageBackend.store.set', { expected: 4, value: 'x'.repeat(61 * 1024) })).rejects.toThrow('store_limit');
    await expect(localPageBackendCapability(mutation, 'artifactbin.pageBackend.store.set', { expected: -1, value: 1 })).rejects.toThrow('backend_capability_forbidden');
    await expect(localPageBackendCapability(mutation, 'artifactbin.pageBackend.unknown', {})).rejects.toThrow('backend_capability_forbidden');
  });
});
