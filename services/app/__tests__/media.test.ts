/**
 * gate-media's HTTP facts (scripts/gates/gate-media.mjs keeps the browser's): a `<File>` card is navigation, so the
 * document that carries one is served under exactly the policy a plain document gets on its own origin: no
 * connect-src, frame-src or object-src is widened for it, and nothing embeds the PDF.
 */
import { describe, expect, it } from 'vitest';
import { samplePdfDataUrl } from '../../../scripts/lib/sample-pdf.mjs';
import { POST as createRoute } from '@/app/api/artifacts/route';
import { pagesOriginFor, pagesSiteFor } from '@/lib/http/pages-origin';
import { drainPreparedPageWarmups } from '@/lib/story/prepared/prepared-page.server';
import { mintAccountToken as mintToken, request, useAppHarness } from '@/__tests__/harness';
import { createAppServer } from '../server/app';

useAppHarness();

const APP = 'https://app.example.test';
const site = pagesSiteFor('pages.example.test', APP)!;
const app = createAppServer({ indexHtml: async () => '<!doctype html><html><head></head><body><div id="root"></div></body></html>', pagesSite: site });

describe('a stored file linked from a document', () => {
  it('widens no part of the document policy: the card is served under the plain document\'s CSP', async () => {
    const t = await mintToken('media');
    const publish = async (json: Record<string, unknown>) => {
      const res = await createRoute(request('/api/artifacts', { method: 'POST', token: t.token, json: { visibility: 'public', ...json } }));
      expect(res.status, await res.clone().text()).toBe(201);
      return ((await res.json()) as { id: string }).id;
    };
    const plain = await publish({ title: 'Plain CSP control', markup: '<p>Plain document</p>' });
    const file = await publish({ title: 'Quarterly review', pdf: samplePdfDataUrl(3) });
    const carded = await publish({ title: 'The review', markup: `<div className="p-10"><h1>The review</h1><File src="ref:${file}" /></div>` });
    await drainPreparedPageWarmups();

    const served = async (id: string) => {
      const res = await app.request(`${pagesOriginFor(id, site)}/`, { headers: { accept: 'text/html' } });
      expect(res.status).toBe(200);
      return { csp: res.headers.get('content-security-policy') ?? '', html: await res.text() };
    };
    const control = await served(plain);
    const withCard = await served(carded);
    expect(withCard.html).toContain(`/a/${file}/raw?v=1`);
    expect(control.csp).not.toBe('');
    // The only difference a policy may carry is the document's own id and origin.
    const asCarded = control.csp.replaceAll(`/a/${plain}/`, `/a/${carded}/`).replaceAll(pagesOriginFor(plain, site), pagesOriginFor(carded, site));
    expect(withCard.csp).toBe(asCarded);
    expect(withCard.csp).not.toMatch(/object-src (?!'none')/);
    expect(withCard.html).not.toMatch(/<(?:object|embed|iframe)\b/);
  });
});
