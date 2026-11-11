/**
 * THE RUNNER WORKER'S PER-QUERY DATABASE CHECK OVER THE REMOTE TRANSPORT, the layout production runs (the runner a
 * separate service): the real worker database host (@artifactbin/runner/worker-database) asks for the check before a
 * `caps.db` query, the runner's own remote adapter (`remoteArtifactbin`) forwards it, and the app's real
 * `/api/runner/operations` handler answers it. Both sides agree on one input shape, an object; the door still refuses
 * anything else.
 */
import { expect, it, vi } from 'vitest';
import { attachActor } from '@artifactbin/utils';
import type { RunStart } from '@artifactbin/contracts';
import { createDatabaseHost, DATABASE_CHECK_OPERATION, DATABASE_OPERATION } from '@artifactbin/runner/worker-database';
import { remoteArtifactbin } from '@artifactbin/runner/capabilities';
import type { CapabilityContext } from '@artifactbin/runner/local';
import { mintAccountToken, request, useAppHarness } from './harness';
import { identityForUser } from '@/lib/accounts';
import { createArtifactFromBody } from '@/lib/publish';
import { readHtmlPage } from '@/lib/html-publication';
import { getHtmlBackendVersion } from '@/lib/html-backends';
import { POST } from '@/app/api/runner/operations/route';

vi.mock('@/lib/page-operations', async (original) => ({
  ...await original<typeof import('@/lib/page-operations')>(),
  compilePageBackend: async (source: string) => ({ typeDefs: 'type Query { rows: Int }', compiled: source, secretBindings: [], secretHosts: {} }),
}));
useAppHarness();

/** A published page with a backend, and the run context a runner holds for one call of it. */
async function run(): Promise<CapabilityContext> {
  const token = await mintAccountToken('dbcheck_owner');
  const owner = identityForUser(token.userId, token.id, token.email);
  const created = await createArtifactFromBody({ visibility: 'unlisted', html: '<html><head><link rel="af-resolver" data-af-name="rows" href="./rows.ts"></head><body>Rows</body></html>', resolverSources: { rows: 'export default {}' } }, owner, 'http://localhost:3000');
  expect(created.status, await created.clone().text()).toBe(201);
  const pageId = (await created.json()).id as string;
  const link = (await readHtmlPage(owner, pageId)).links.find((l) => l.kind === 'backend');
  if (link?.kind !== 'backend') throw Error('missing backend link');
  const backend = (await getHtmlBackendVersion(link.backendId, link.version))!;
  const start: RunStart = {
    requestId: 'run-dbcheck', userId: backend.ownerId, pageBackendOperation: 'query', artifactId: backend.backendId, artifactVersion: backend.version,
    program: { source: backend.compiled, language: 'javascript' }, document: { source: backend.compiled, editId: backend.version },
    input: { kind: 'invoke', principal: { tenant: backend.pageId, subject: token.userId, role: 'owner' } },
  };
  return { runId: 'run-dbcheck', callId: 1, request: start, signal: new AbortController().signal, requests: [], usage: [] };
}

/** The app's real handler as the runner reaches it: the request carries the runner's signed actor. */
const app = remoteArtifactbin('http://app.internal', async (incoming, actor) => POST(attachActor(incoming, actor)));

it('answers the worker\'s check before a caps.db query through the real handler, so the query goes ahead', async () => {
  const context = await run();
  const checks: Array<{ input: unknown; answer: unknown }> = [];
  const host = createDatabaseHost({
    send: () => {},
    call: async (operation: string, input: unknown) => {
      if (operation === DATABASE_OPERATION) return { kind: 'postgres', host: 'db.example.test', port: 5432, database: 'd', user: 'u', password: 'p', tls: 'disable', grant: 'g' };
      expect(operation).toBe(DATABASE_CHECK_OPERATION);
      checks.push({ input, answer: await app(context, operation, input as never) });
      // The check passed; stop before the driver opens a tunnel nobody answers.
      throw Error('checked');
    },
  });
  const id = await host.open('FIN');
  await expect(host.query(id, 'select 1', [])).rejects.toThrow('checked');
  expect(checks).toEqual([{ input: {}, answer: null }]);
  await host.end(id);
});

it('keeps the one input shape at the door: an operation without an object input is refused', async () => {
  const context = await run();
  for (const input of [null, [], 'x']) await expect(app(context, DATABASE_CHECK_OPERATION, input as never)).rejects.toThrow('invalid_operation_input');
  const forged = await POST(request('/api/runner/operations', { method: 'POST', json: { operation: 'pageBackend.dbCheck', input: {} } }));
  expect(forged.status).toBe(403);
});
