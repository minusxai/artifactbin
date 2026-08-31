/**
 * Helmet at the publish door: a markup document
 * may carry ONE <Helmet> with <title>/<style>/<script>; canonicalization hoists
 * it to first top-level node; script stays hard-denied in the BODY. The echo in
 * every write response is the stored (canonicalized) source, so agents see the
 * hoist in the response of their own write.
 */
import { storedMarkup } from '@/test/helpers/echo';
import { describe, expect, it } from 'vitest';
import { POST as createArtifactRoute } from '@/app/api/artifacts/route';


import { mintToken } from '@/lib/tokens';
import { useAppHarness, request } from '@/__tests__/harness';

useAppHarness();

const BASE = 'http://localhost:3000';

const create = async (token: string, body: Record<string, unknown>) =>
  createArtifactRoute(request('/api/artifacts', { method: 'POST', token: token, json: body }));

const HELMET =
  '<Helmet><title>Scripted doc</title><style>{`h1 { letter-spacing: -0.02em; }`}</style><script>{`document.body.dataset.ran = "1";`}</script></Helmet>';
const BODY = '<h1 className="text-4xl font-bold">Hello</h1>';

describe('Helmet publish contract', () => {
  it('publishes a Helmet-bearing document; already-canonical source is stored verbatim', async () => {
    const t = await mintToken('t');
    const res = await create(t.token, { markup: HELMET + BODY });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { markup?: string; markup_changed?: boolean; title: string };
    // Nothing to rewrite: the write says the stored document IS what was sent,
    // rather than sending it back.
    expect(body.markup_changed).toBe(false);
    const stored = storedMarkup(body, HELMET + BODY);
    expect(stored).toContain('<Helmet>');
    expect(stored).toContain('document.body.dataset.ran');
  });

  it('hoists a nested Helmet to the first top-level node (visible in the write echo)', async () => {
    const t = await mintToken('t');
    const res = await create(t.token, { markup: '<div className="p-4">' + HELMET + '<p>body</p></div>' });
    expect(res.status).toBe(201);
    const { markup } = (await res.json()) as { markup: string };
    expect(markup.trimStart().startsWith('<Helmet>')).toBe(true);
    // Removed from its authored position, present exactly once.
    expect(markup.match(/<Helmet>/g)).toHaveLength(1);
  });

  it('derives the stored title from <Helmet><title> when the body has none', async () => {
    const t = await mintToken('t');
    const res = await create(t.token, { markup: HELMET + BODY });
    const { title } = (await res.json()) as { title: string };
    expect(title).toBe('Scripted doc');
  });

  it('an explicit title in the request wins over the Helmet title', async () => {
    const t = await mintToken('t');
    const res = await create(t.token, { markup: HELMET + BODY, title: 'Named by hand' });
    const { title } = (await res.json()) as { title: string };
    expect(title).toBe('Named by hand');
  });

  it('still rejects <script> in the BODY', async () => {
    const t = await mintToken('t');
    const res = await create(t.token, { markup: BODY + '<script>{`alert(1)`}</script>' });
    expect(res.status).toBe(400);
    const { error } = (await res.json()) as { error: string };
    expect(error).toBe('invalid_jsx');
  });

  it('rejects two Helmets with a diagnostic', async () => {
    const t = await mintToken('t');
    const res = await create(t.token, { markup: HELMET + '<div><Helmet><title>x</title></Helmet></div>' });
    expect(res.status).toBe(400);
    const { details } = (await res.json()) as { details: Array<{ message: string }> };
    expect(details.some((d) => /one <Helmet>/i.test(d.message))).toBe(true);
  });

  it('rejects `</script` inside the Helmet script', async () => {
    const t = await mintToken('t');
    const res = await create(t.token, {
      markup: '<Helmet><script>{`var s = "</scr" + "ipt>"; var bad = "</script>";`}</script></Helmet>' + BODY,
    });
    expect(res.status).toBe(400);
    const { details } = (await res.json()) as { details: Array<{ message: string }> };
    expect(details.some((d) => /<\/script/i.test(d.message))).toBe(true);
  });

  it('sanitizes banned CSS inside the Helmet style (external @import stripped, siblings kept)', async () => {
    const t = await mintToken('t');
    const res = await create(t.token, {
      markup:
        '<Helmet><style>{`@import url("https://evil.example/x.css"); h1 { color: red; }`}</style></Helmet>' + BODY,
    });
    expect(res.status).toBe(201);
    const { markup } = (await res.json()) as { markup: string };
    expect(markup).not.toContain('evil.example');
    expect(markup).toContain('color: red');
  });

  it('canonical form is a fixpoint: republishing the echo returns it byte-identical', async () => {
    const t = await mintToken('t');
    const first = await create(t.token, { markup: '<div className="p-4">' + HELMET + '<p>body</p></div>' });
    // The nested Helmet was hoisted, so THIS write echoes.
    const { markup: canonical, markup_changed } = (await first.json()) as { markup: string; markup_changed: boolean };
    expect(markup_changed).toBe(true);
    const second = await create(t.token, { markup: canonical });
    expect(second.status).toBe(201);
    // Republishing canonical form changes nothing — which the write now states
    // outright instead of proving by handing the bytes back.
    const { markup: again, markup_changed: changedAgain } = (await second.json()) as { markup?: string; markup_changed: boolean };
    expect(changedAgain).toBe(false);
    expect(again).toBeUndefined();
  });
});
