/**
 * "Readable = exportable" — including for a PRIVATE document.
 *
 * The exporter drives a headless browser with no session, so the page admits
 * it with a signed, seconds-long key (lib/export-key). The catch is that the
 * page is only the outside: the document itself lives in a frame whose request
 * is a SEPARATE, credential-less GET of /a/<id>/raw. If that request is not
 * admitted too, the shot succeeds and returns a 200 PNG — of a 404 page.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { GET as rawRoute } from '@/app/a/[id]/raw/route';
import { createArtifact } from '@/lib/artifacts';

import { mintExportKey } from '@/lib/export-key';
import { mintToken } from '@/lib/tokens';
import { createUser } from '@/lib/users';
import { useAppHarness, request } from '@/__tests__/harness';

useAppHarness();

const BASE = 'http://localhost:3000';
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const rawResponse = (path: string) => rawRoute(request(path), params(path.split('/')[2]));

let privateId: string;

beforeEach(async () => {
  const user = await createUser({ email: 'owner@example.com' });
  const token = await mintToken('t', user.id);
  const row = await createArtifact(token.id, user.id, {
    format: 'markup', content: '', source: '<h1>secret body</h1>', meta: {},
    title: 'Secret', description: null, visibility: 'private',
  });
  privateId = row.id;
});

describe('GET /a/<id>/raw with an export key', () => {
  it('serves the document, so the captured frame is the document and not a 404', async () => {
    const res = await rawResponse(`/a/${privateId}/raw?chrome=0&key=${mintExportKey(privateId)}`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('secret body');
  });

  it('still carries the sandbox CSP — the key admits a reader, it does not relax the policy', async () => {
    const res = await rawResponse(`/a/${privateId}/raw?key=${mintExportKey(privateId)}`);
    expect(res.headers.get('content-security-policy')).toContain('sandbox');
    expect(res.headers.get('content-security-policy')).toContain("default-src 'none'");
  });

  it('refuses a missing, malformed, or foreign key with the uniform 404', async () => {
    const other = await createArtifact((await mintToken('u')).id, null, {
      format: 'markup', content: '', source: '<h1>other</h1>', meta: {}, title: 'Other', description: null,
    });
    for (const key of ['', 'not-a-key', mintExportKey(other.id)]) {
      const res = await rawResponse(`/a/${privateId}/raw${key ? `?key=${key}` : ''}`);
      expect(res.status, key || '(none)').toBe(404);
    }
  });
});
