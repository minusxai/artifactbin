/**
 * ONE document input: the API accepts `markup`
 * and nothing else. HTML is the vocabulary INSIDE a document — prose is written
 * as ordinary tags — and markdown is not an authoring language here at all.
 * Both retired keys are rejected by NAME, so an agent sending the old shape is
 * told what replaced it rather than reading a bare "one of".
 */
import { storedMarkup } from '@/test/helpers/echo';
import { describe, expect, it } from 'vitest';
import { POST as createArtifactRoute } from '@/app/api/artifacts/route';


import { mintToken } from '@/lib/tokens';
import { displayTitle } from '@/lib/story/title';
import { useAppHarness, request } from '@/__tests__/harness';

useAppHarness();

const BASE = 'http://localhost:3000';

const create = async (token: string, body: Record<string, unknown>) =>
  createArtifactRoute(request('/api/artifacts', { method: 'POST', token: token, json: body }));

describe('markup is the only document input', () => {
  it('rejects `markdown`, naming the component that replaces it', async () => {
    const t = await mintToken('t');
    const res = await create(t.token, { markdown: '# Hello\n\nBody text.' });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; hint?: string };
    expect(body.error).toBe('markup_only');
    expect(`${body.hint}`).toMatch(/markup/i);
  });

  it('rejects `html`, naming the tags that replace it', async () => {
    const t = await mintToken('t');
    const res = await create(t.token, { html: '<!doctype html><p>x</p>' });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; hint?: string };
    expect(body.error).toBe('markup_only');
    expect(`${body.hint}`).toMatch(/markup/i);
  });

  it('accepts prose written as ordinary HTML, and stores it as markup', async () => {
    const t = await mintToken('t');
    const res = await create(t.token, {
      markup: '<h1>Quarterly</h1><p>Revenue was <strong>up</strong>.</p>',
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { format: string; markup?: string; markup_changed?: boolean };
    expect(body.format).toBe('markup');
    // Prose needed no rewriting, so the write says so instead of repeating it.
    expect(body.markup_changed).toBe(false);
    const stored = storedMarkup(body, '<h1>Quarterly</h1><p>Revenue was <strong>up</strong>.</p>');
    expect(stored).toContain('<h1>');
    // The title is DERIVED at display time (nothing is stored) from the
    // document's own first heading.
    expect(displayTitle({ title: null, source: stored })).toBe('Quarterly');
  });

  it('a Helmet title still beats a markdown heading', async () => {
    const t = await mintToken('t');
    const res = await create(t.token, {
      markup: '<Helmet><title>Named</title></Helmet><h1>Heading</h1>',
    });
    const { title } = (await res.json()) as { title: string };
    expect(title).toBe('Named');
  });

  it('still rejects a body with no content field at all', async () => {
    const t = await mintToken('t');
    const res = await create(t.token, { title: 'nothing' });
    expect(res.status).toBe(400);
  });

  it('the data tiers are untouched by the collapse', async () => {
    const t = await mintToken('t');
    const res = await create(t.token, { dataset: [{ a: 1 }], title: 'rows' });
    expect(res.status).toBe(201);
  });
});

/**
 * HTML is an ALLOWLIST, and an agent's only route out of a rejection is being
 * told the set. The set is attached ONCE per response — repeating ~130 tokens
 * of vocabulary inside every offending tag's message is how a rejection turns
 * into context bloat, and a document can carry many.
 */
describe('the allowed HTML vocabulary is discoverable', () => {
  it('names the set once when a tag is refused, not once per tag', async () => {
    const t = await mintToken('t');
    const res = await create(t.token, { markup: '<marquee>a</marquee><blink>b</blink>' });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; details: Array<{ message: string }>; allowed_html_tags?: string[] };
    expect(body.error).toBe('invalid_jsx');
    expect(body.details).toHaveLength(2);
    expect(body.allowed_html_tags).toBeDefined();
    expect(body.allowed_html_tags).toContain('div');
    // The vocabulary appears once in the payload, not per error.
    expect(JSON.stringify(body).match(/"figcaption"/g) ?? []).toHaveLength(1);
  });

  it('stays out of the way when the failure has nothing to do with tags', async () => {
    const t = await mintToken('t');
    const res = await create(t.token, { markup: '<p onclick="x()">a</p>' });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { allowed_html_tags?: string[] };
    expect(body.allowed_html_tags).toBeUndefined();
  });

  it('accepts the media elements the document CSP already permits', async () => {
    const t = await mintToken('t');
    // media-src 'self' data: blob: is in the served document's CSP, but <video>
    // and <audio> were not in the vocabulary — <source> was, with nothing to put it in.
    const res = await create(t.token, {
      markup: '<figure><video controls><source src="ref:abc" /><track kind="captions" /></video><audio controls></audio></figure>',
    });
    expect(res.status).toBe(201);
  });
});
