/**
 * Every body a browser gate publishes is still accepted by the real publish handlers.
 *
 * Gates run on main only. #1200 moved the tracker starter from a GraphQL `tracker` mutation to `/fn/add`; the
 * offline-file gate still published a page sending that mutation and main went red with 400 `invalid_page_graphql`
 * after merge. This reads every create and replace body the manifest's gates send (scripts/lib/gate-pages.mjs: evaluated
 * from the gate sources, none run) and sends each through `POST /api/artifacts` and `PUT /api/artifacts/:id`, in
 * process, as one signed-in account. What a gate's helpers request on the way (an image whose id a page then names, the
 * import map a fixture reads library URLs from) is answered by the same handlers. A value known only while a gate runs
 * reads as a real dataset this account owns; a body field that is wholly such a value is left out (a parent is this
 * account's folder), and a replace carries the target's current head, as the gates' fixture client sends it.
 * scripts/__tests__/gate-pages.test.mjs checks the same pages' scripts and imports, in pr fast.
 *
 * NOT IN PR FAST: a node-project file the full suite runs after merge (ci.yml's node job), before the gates finish. In
 * pr fast's api lane it took 9.6 s on one runner (run 44139942068; about 2 s locally), past the lane's per-file budget,
 * and made that runner the run's slowest (56 s, against 41-50 s for the five runs before it).
 */
import { expect, it } from 'vitest';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { mintAccountToken, request, useAppHarness, params } from '@/__tests__/harness';
import { POST as create } from '@/app/api/artifacts/route';
import { PUT as replace } from '@/app/api/artifacts/[id]/route';
import { GET as importMap } from '@/app/af/import-map.json/route';
import { gateInputs, isPlaceholder } from '../../../../../scripts/lib/gate-pages.mjs';

useAppHarness();
const ROOT = path.resolve(import.meta.dirname, '..', '..', '..', '..', '..');
const STARTED = '<!doctype html><html><head><title>Gate target</title></head><body><h1>Gate target</h1></body></html>';

it('accepts every body a gate publishes', async () => {
  const { token } = await mintAccountToken('gate-publish');
  const send = async (method: 'POST' | 'PUT', id: string | null, json: Record<string, unknown>) => {
    // A create carries an idempotency key, as the gates' publish helpers send (a publication bundle requires one).
    const response = method === 'POST'
      ? await create(request('/api/artifacts', { method, token, json, headers: { 'idempotency-key': `gate_publish_${randomUUID().replaceAll('-', '')}` } }))
      : await replace(request(`/api/artifacts/${id}`, { method, token, json }), params(id!));
    return { status: response.status, body: await response.json().catch(() => null) as Record<string, unknown> | null };
  };
  const created = async (json: Record<string, unknown>) => {
    const reply = await send('POST', null, json);
    expect(reply.status).toBe(201);
    return reply.body as { id: string; version: number; state: string };
  };
  const dataset = await created({ dataset: [{ region: 'North', amount: 1 }], visibility: 'unlisted' });
  const folder = await created({ format: 'folder', title: 'Gate folder' });
  // Every replace lands on one document the gate would have started, guarded by its current head as the gates'
  // fixture client sends it (scripts/gates/lib/fixture-http.mjs). A body sent twice (published while evaluating a later
  // one, then for itself) is sent once.
  const target = await created({ html: STARTED, visibility: 'unlisted' });
  let head = { version: target.version, state: target.state };
  const answers = new Map<string, Promise<{ status: number; body: Record<string, unknown> | null }>>();
  const publish = (route: 'create' | 'replace', body: Record<string, unknown>) => {
    const json = Object.fromEntries(Object.entries(body).flatMap(([field, value]) =>
      !isPlaceholder(value) && value !== dataset.id ? [[field, value]] : field === 'parent_id' ? [[field, folder.id]] : []));
    const key = `${route} ${JSON.stringify(json)}`;
    if (!answers.has(key)) answers.set(key, (async () => {
      if (route === 'create') return send('POST', null, json);
      const reply = await send('PUT', target.id, { ...json, expectedVersion: head.version, expectedState: head.state });
      if (reply.status < 300) head = { version: Number(reply.body!.version), state: String(reply.body!.state) };
      return reply;
    })());
    return answers.get(key)!;
  };
  // What a gate requests on its way to a body is answered in process: a publish (the image a page then names), a
  // document's head, the import map a fixture reads its library URLs from.
  let image: ReturnType<typeof publish> | undefined;
  const serve = async (method: string, at: string, body: unknown) => {
    const answer = (reply: { status: number; body: unknown }) => Response.json(reply.body, { status: reply.status });
    const json = body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : null;
    if (method === 'POST' && /^\/api\/(?:my\/)?artifacts$/.test(at) && json) {
      // Images uploaded on the way (a gallery's 32 covers) are one real image: a body needs only an image's id, and each
      // image body is replayed for itself below. Converting each costs ~200 ms.
      if (typeof json.image === 'string') return answer(await (image ??= publish('create', json)));
      return answer(await publish('create', json));
    }
    if (method === 'PUT' && /^\/api\/(?:my\/)?artifacts\/[A-Za-z0-9]+$/.test(at) && json) return answer(await publish('replace', json));
    if (method === 'GET' && /^\/api\/artifacts\/[A-Za-z0-9]+$/.test(at)) return Response.json({ format: 'html', ...head });
    if (method === 'GET' && at === '/af/import-map.json') return importMap(request(at));
    return null;
  };
  const { publishes, failures } = await gateInputs(ROOT, { placeholder: dataset.id, serve });
  expect(failures).toEqual([]);
  expect(publishes.filter(({ route }) => route === 'create').length).toBeGreaterThan(50);
  expect(publishes.filter(({ route }) => route === 'replace').length).toBeGreaterThan(20);
  const refused = [];
  for (const { at, route, body } of publishes) {
    const sent = await publish(route, body as Record<string, unknown>);
    if (sent.status >= 300) refused.push(`${at}: ${route} ${sent.status} ${JSON.stringify(sent.body).slice(0, 300)}`);
  }
  expect(refused).toEqual([]);
});
