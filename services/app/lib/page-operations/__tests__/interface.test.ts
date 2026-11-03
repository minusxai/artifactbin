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
    setServices({ runner: fakeRunner({ typeDefs: 'type Query { count: Int! }', secrets: { ZED: 'z.example.com', API_TOKEN: 'api.example.com' } }, started) });
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
    setServices({ runner: fakeRunner({ typeDefs: 'type Query { a: Int }', secrets: { lower: 'a.example.com' } }) });
    await expect(compilePageBackend('export default {}')).rejects.toThrow('invalid_secrets');
  });

  it('binds a secrets map to hosts and gives every source the same caps: fetch and query, never a store or secret reads', async () => {
    const plain = 'export const secrets = {SHEETS_KEY: "sheets.googleapis.com"}; export default { n: (a, p, caps) => caps.fetch("https://sheets.googleapis.com") };';
    setServices({ runner: fakeRunner({ typeDefs: 'type Query { n: Int }', secrets: { SHEETS_KEY: 'sheets.googleapis.com' } }) });
    expect(await compilePageBackend(plain)).toMatchObject({ secretBindings: ['SHEETS_KEY'], secretHosts: { SHEETS_KEY: 'sheets.googleapis.com' }, test: false });
    setServices({ runner: fakeRunner({ typeDefs: 'type Query { n: Int }' }) });
    expect(await compilePageBackend('export default { n: () => 1 };')).toMatchObject({ secretBindings: [], secretHosts: {} });
    for (const removed of ['export default { n: async (a, p, caps) => (await caps.store.get()).value };', 'export default { n: (a, p, caps) => caps.secrets.get("TOKEN") };']) {
      const compiled = (await compilePageBackend(removed)).compiled;
      expect(compiled).toContain("'pageBackend.fetch'"); expect(compiled).toContain("'pageBackend.query'");
      expect(compiled).not.toMatch(/'pageBackend\.(?:store|secrets)\./);
    }
    // A removed `secretBindings` export declares nothing.
    setServices({ runner: fakeRunner({ typeDefs: 'type Query { n: Int }', secretBindings: ['TOKEN'] }) });
    expect(await compilePageBackend('export const secretBindings = ["TOKEN"]; export default {};')).toMatchObject({ secretBindings: [], secretHosts: {} });
    for (const secrets of [['KEY'], { KEY: 'https://api.example.com' }, { KEY: 'sk_live_value' }, { key: 'api.example.com' }]) {
      setServices({ runner: fakeRunner({ typeDefs: 'type Query { n: Int }', secrets }) });
      await expect(compilePageBackend('export default {}')).rejects.toThrow('invalid_secrets');
    }
  });

  it('accepts an optional owner-only test query field and refuses any other test shape', async () => {
    for (const typeDefs of ['type Query { n: Int test: String! @auth(role: owner) }', 'type Query { n: Int test: String! @auth(role: OWNER) }', 'type Query { test(verbose: Boolean): String! @auth(role: OWNER) }']) {
      setServices({ runner: fakeRunner({ typeDefs }) });
      expect((await compilePageBackend('export default {}')).test).toBe(true);
    }
    for (const typeDefs of ['type Query { test: Boolean! @auth(role: OWNER) }', 'type Query { test: String @auth(role: OWNER) }', 'type Query { test: [String!]! @auth(role: OWNER) }', 'type Query { test: String! }', 'type Query { test: String! @auth(role: EDITOR) }', 'type Query { test: String! @auth(role: editor) }', 'type Query { test: String! @auth(signedIn: true) }', 'type Query { test(id: ID!): String! @auth(role: OWNER) }', 'type Query { n: Int } type Mutation { test: String! @auth(role: OWNER) }']) {
      setServices({ runner: fakeRunner({ typeDefs }) });
      await expect(compilePageBackend('export default {}'), typeDefs).rejects.toThrow('invalid_test_field');
    }
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
    await db.query("INSERT INTO html_backend_versions (backend_id, version, page_id, name, source, type_defs, compiled, owner_id, secret_bindings, secret_hosts) VALUES ('be_1', 'v1', $1, 'tasks', 'src', 'type Query { a: Int }', 'compiled-program', $2, '[\"API_TOKEN\"]'::jsonb, '{\"API_TOKEN\":\"api.example.com\"}'::jsonb)", [pageId, owner.userId]);
    await backendSecrets.put({ ownerId: owner.userId!, backendId: 'be_1' }, 'API_TOKEN', 'secret-value');
    const run: RunStart = { requestId: 'req', pageBackendOperation: 'query', userId: owner.userId!, artifactId: 'be_1', artifactVersion: 'v1', program: { source: 'compiled-program', language: 'javascript' }, input: { kind: 'invoke', principal: { tenant: pageId, subject: null } } } as RunStart;
    return { owner, pageId, run };
  }

  it('never hands a declared secret value or a store to the pinned resolver', async () => {
    const { run } = await backend();
    for (const [operation, args] of [['artifactbin.pageBackend.secrets.get', { name: 'API_TOKEN' }], ['artifactbin.pageBackend.store.get', null], ['artifactbin.pageBackend.store.set', { expected: 0, value: 1 }]] as const)
      await expect(localPageBackendCapability({ ...run, pageBackendOperation: 'mutation' } as RunStart, operation, args)).rejects.toThrow('backend_capability_forbidden');
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
    ]) await expect(localPageBackendCapability(bad as RunStart, 'artifactbin.pageBackend.fetch', { url: 'https://api.example.com/' })).rejects.toThrow('backend_capability_forbidden');
  });

  it('refuses unknown operations, and caps.query without the composition\'s port', async () => {
    const { run } = await backend();
    const mutation = { ...run, pageBackendOperation: 'mutation' } as RunStart;
    await expect(localPageBackendCapability(mutation, 'artifactbin.pageBackend.unknown', {})).rejects.toThrow('backend_capability_forbidden');
    await expect(localPageBackendCapability(mutation, 'artifactbin.pageBackend.query', { query: '{ x }' })).rejects.toThrow('backend_capability_forbidden');
  });
});
