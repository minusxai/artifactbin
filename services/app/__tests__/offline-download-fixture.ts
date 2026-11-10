/**
 * The offline download suites' shared fixture (offline-download-route*.test.ts).
 */
import { expect } from 'vitest';
import { request, mintAccountToken } from '@/__tests__/harness';
import { POST } from '@/app/api/artifacts/route';

export const params = (id: string) => ({ params: Promise.resolve({ id }) });
export const source = '<!doctype html><html><head><title>Trip plan</title><style>.status{color:rgb(20,90,40)}</style><script type="application/json" data-af="state">{"count":3,"label":"&lt;route&gt;"}</script><script src="/af/core.js"></script><script type="module">import {client,gql} from "@afbin/apollo";</script></head><body><h1 class="status">Trip plan</h1><svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"></circle></svg><img alt="Portable pixel" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"></body></html>';
export async function publish(visibility: 'private' | 'unlisted') {
  const actor = await mintAccountToken(`native-download-${visibility}`);
  const response = await POST(request('/api/artifacts', { method: 'POST', token: actor.token, json: { html: source, visibility } }));
  expect(response.status, await response.clone().text()).toBe(201);
  return { actor, id: (await response.json()).id as string };
}
