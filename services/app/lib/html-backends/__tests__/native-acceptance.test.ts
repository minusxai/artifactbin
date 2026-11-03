/**
 * The server's production acceptance scenario (services/app/testing/native-acceptance.mjs), through the real route
 * handlers, the real resolver compiler and a real V8 isolate. minusxai/artifactbin-server runs the same module against
 * its built composition after merge; this runs it on every product pull request (pr fast's contract tier,
 * scripts/ci/contract-tests.json), so a contract change that breaks the scenario fails here first.
 */
import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { createRunner } from '@artifactbin/runner/local';
import { localPageBackendCapability } from '@/lib/page-operations';
import { setServices } from '@/lib/platform';
import { POST as publish } from '@/app/api/artifacts/route';
import { GET as discover, POST as graphql } from '@/app/api/artifacts/[id]/graphql/route';
import { mintAccountToken, request, useAppHarness } from '@/__tests__/harness';
import { MARKER_PREFIX, OPERATIONS, RESOLVER_NAME, SCHEMA_SDL, publishBody } from '@/testing/native-acceptance.mjs';

const harness = useAppHarness();

it('publishes the acceptance page, answers its read and owner write, and refuses the guest write', async () => {
  const runner = await createRunner({ db: await harness.db(), capabilities: (context, operation, args) => localPageBackendCapability(context.request, operation, args) });
  setServices({ runner });
  try {
    const owner = await mintAccountToken('native-acceptance');
    const marker = MARKER_PREFIX + randomUUID();
    const published = await publish(request('/api/artifacts', { method: 'POST', token: owner.token, headers: { 'Idempotency-Key': randomUUID() }, json: publishBody(marker) }));
    const created = await published.json();
    expect(published.status, JSON.stringify(created)).toBe(201);
    expect(created.html).toContain(marker);
    const path = `/api/artifacts/${created.id}/graphql`, context = { params: Promise.resolve({ id: created.id }) };
    const schema = await (await discover(request(path, { token: owner.token }), context)).json();
    expect(schema.revision).toEqual(expect.any(String));
    expect(schema.sdl).toMatch(SCHEMA_SDL);
    const send = async (query: string, token?: string) => {
      const response = await graphql(request(path, { method: 'POST', token, json: { revision: schema.revision, query } }), context);
      return { status: response.status, body: await response.json() };
    };
    const read = await send(OPERATIONS.read.query, owner.token);
    expect(read).toMatchObject({ status: 200, body: { data: OPERATIONS.read.data } });
    expect(read.body.errors).toBeUndefined();
    const write = await send(OPERATIONS.ownerWrite.query, owner.token);
    expect(write).toMatchObject({ status: 200, body: { data: OPERATIONS.ownerWrite.data } });
    expect(write.body.errors).toBeUndefined();
    const guest = await send(OPERATIONS.guestWrite.query);
    expect(guest.status >= 400 || guest.body.errors?.length > 0, JSON.stringify(guest)).toBe(true);
    expect(guest.body.data?.[RESOLVER_NAME]?.increment ?? null).toBeNull();
  } finally {
    await runner.close();
  }
}, 20000);
