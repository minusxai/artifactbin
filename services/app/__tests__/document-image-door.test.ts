/**
 * A DOC'S EXTERNAL IMAGE, served through the page's first-view door (lib/document-serving native-html-assets.server):
 * a private document framed on its own origin names the image as `/a/<id>/assets?u=<url>`, and that door admits the
 * frame's reader by the document origin's own cookie, exactly as an `<img>` there asks it, while a browser without
 * that cookie gets the uniform 404. The fetch itself is refused here by the network guard (a loopback address), which
 * shows the door admitted the reader and asked for the bytes without this test leaving the machine.
 */
import { beforeEach, afterEach, expect, it } from 'vitest';
import { attachActor } from '@artifactbin/utils';
import type { Actor } from '@artifactbin/contracts/actor';
import { useAppHarness, request, testPagesSite, mintAccountToken } from '@/__tests__/harness';
import { POST as createRoute } from '@/app/api/artifacts/route';
import { createUser } from '@/lib/accounts/testing';
import { setServices } from '@/lib/platform';
import { pagesOriginFor } from '@/lib/http';
import { restoreWebIngestPolicy, setWebIngestPolicy } from '@/test/helpers/web-ingest';
import { createAppServer } from '../server/app';

useAppHarness();

const APP = 'https://app.example.test';
const site = testPagesSite('pages.example.test', APP)!;
const COOKIE = '__Host-afbin_pages';
const IMAGE = 'https://127.0.0.1/chart.png';
const SHELL = '<!doctype html><html><head><title>artifactbin</title></head><body><div id="root"></div></body></html>';
beforeEach(() => { setServices({ humanSessions: { live: async ref => ref === 'test-session' } }); setWebIngestPolicy({ allowPrivate: false, allowHttp: false }); });
afterEach(() => restoreWebIngestPolicy());

it('a private doc\'s uncached external image loads through the first-view door for the frame\'s reader only', async () => {
  const user = await createUser({ email: 'mxmx_test_doc_image_door@example.com' });
  const { token } = await mintAccountToken('doc-image-door', user.id);
  const region = `<p>Chart: <img src="${IMAGE}" alt="chart"></p>`;
  const created = await createRoute(request('/api/artifacts', { method: 'POST', token, json: { html: `<!doctype html><html><head></head><body><article data-af-editable="rich-native-v1">${region}</article></body></html>`, visibility: 'private' } }));
  expect(created.status, await created.clone().text()).toBe(201);
  const { id } = await created.json() as { id: string };
  const actor: Actor = { credential: 'session', sessionId: 'test-session', userId: user.id, email: user.email!, emailVerified: true };
  const app = createAppServer({ indexHtml: async () => SHELL, pagesSite: site });

  // The app page frames the document on its own origin; the frame's first load spends the ticket and sets the cookie.
  const page = await app.request(attachActor(new Request(`${APP}/a/${id}`, { headers: { accept: 'text/html' } }), actor));
  const frame = new URL(/<iframe data-mx-document-frame="" src="([^"]+)"/.exec(await page.text())![1]!.replaceAll('&amp;', '&'));
  const served = await app.request(frame.href);
  expect(served.status).toBe(200);
  const cookie = new RegExp(`${COOKIE}=([^;]+)`).exec(served.headers.get('set-cookie') ?? '')![1]!;
  const src = /<img[^>]* src="([^"]+)"[^>]*alt="chart"/.exec(await served.text())![1]!.replaceAll('&amp;', '&');
  expect(src).toBe(`/a/${id}/assets?u=${encodeURIComponent(IMAGE)}`);

  const self = pagesOriginFor(id, site);
  const asked = await app.request(`${self}${src}`, { headers: { accept: 'image/*', cookie: `${COOKIE}=${cookie}` } });
  expect([asked.status, await asked.json()]).toEqual([400, expect.objectContaining({ error: 'asset_fetch_failed', code: 'forbidden_address' })]);
  expect((await app.request(`${self}${src}`, { headers: { accept: 'image/*' } })).status).toBe(404);
});
