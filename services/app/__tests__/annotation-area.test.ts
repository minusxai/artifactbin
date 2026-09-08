/**
 * A DRAWN AREA IS STORED IN THE SAME COLUMN AS THE WORDS — `range`, tagged
 * `kind: 'area'` — and comes back on every read exactly as sent, with no
 * quote and `quote_found` null (there were no words). The door refuses a box
 * outside the grammar by the same name a bad text range gets.
 */
import { describe, expect, it } from 'vitest';
import { GET as listAnnotationsRoute } from '@/app/api/artifacts/[id]/annotations/route';
import { GET as getArtifactRoute } from '@/app/api/artifacts/[id]/route';
import { POST as createArtifactRoute } from '@/app/api/artifacts/route';
import { POST as myCreateAnnotationRoute } from '@/app/api/my/artifacts/[id]/annotations/route';
import { mintToken } from '@/lib/tokens';
import { agentCookie, request, useAppHarness } from '@/__tests__/harness';

useAppHarness();
const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });

const DOC = '<section><p>Revenue grew 40% in Q3.</p><ul><li>one</li><li>two</li></ul></section>';
const AREA = { v: 1, kind: 'area', box: { x: 0.2, y: 0.05, w: 0.5, h: 0.4 } };

interface Wire { id: string; orphaned: boolean; anchor: { key: string; path: string } | null; snippet: string; quote: string | null; range: unknown; quote_found: boolean | null }

async function setup() {
  const t = await mintToken('agent');
  const res = await createArtifactRoute(request('/api/artifacts', { method: 'POST', token: t.token, json: { markup: DOC } }));
  expect(res.status, await res.clone().text()).toBe(201);
  const doc = (await res.json()) as { id: string; edit_id: string; version: number };
  return { t, doc, cookie: await agentCookie([t.id]) };
}
const comment = (w: Awaited<ReturnType<typeof setup>>, extra: Record<string, unknown>) =>
  myCreateAnnotationRoute(
    request(`/api/my/artifacts/${w.doc.id}/annotations`, { browser: true, method: 'POST', cookie: w.cookie, json: { path: '0', edit_id: w.doc.edit_id, body: 'this region', ...extra } }),
    params({ id: w.doc.id }),
  );
const list = async (token: string, id: string): Promise<Wire[]> => {
  const res = await listAnnotationsRoute(request(`/api/artifacts/${id}/annotations`, { token }), params({ id }));
  expect(res.status).toBe(200);
  const body = (await res.json()) as { annotations?: Wire[] } | Wire[];
  return Array.isArray(body) ? body : body.annotations ?? [];
};

describe('an area comment', () => {
  it('stores the box as the range and reads it back with no quote', async () => {
    const w = await setup();
    const res = await comment(w, { range: AREA });
    expect(res.status, await res.clone().text()).toBe(201);
    const made = (await res.json()) as Wire;
    expect(made.range).toEqual(AREA);
    expect(made.quote).toBeNull();
    expect(made.quote_found).toBeNull();
    expect(made.anchor?.path).toBe('0');
    expect(made.snippet).toContain('Revenue grew');

    const [listed] = await list(w.t.token, w.doc.id);
    expect(listed.range).toEqual(AREA);
    expect(listed.quote_found).toBeNull();
    const head = await getArtifactRoute(request(`/api/artifacts/${w.doc.id}`, { token: w.t.token }), params({ id: w.doc.id }));
    const inlined = (await head.json()) as { annotations: Wire[] };
    expect(inlined.annotations[0].range).toEqual(AREA);
  });

  it('refuses a box outside the grammar by name, and never takes a quote with an area', async () => {
    const w = await setup();
    const bad = await comment(w, { range: { v: 1, kind: 'area', box: { x: 0.8, y: 0.1, w: 0.5, h: 0.4 } } });
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { error: string }).error).toBe('bad_range');
    const missing = await comment(w, { range: { v: 1, kind: 'area' } });
    expect(missing.status).toBe(400);
    // A quote beside an area is a contradiction: the area has no words. Refused, not silently dropped.
    const both = await comment(w, { range: AREA, quote: 'Revenue grew' });
    expect(both.status).toBe(400);
    expect(((await both.json()) as { error: string }).error).toBe('bad_range');
  });
});
