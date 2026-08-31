/**
 * The served document carries its reading chrome — the outline, the table
 * rules — from the SERVER, and not for a capture. Checked at the door a reader
 * actually comes through (/a/<id>/raw), so what the unit tests say about the
 * runtime is also true of the bytes on the wire.
 */
import { describe, expect, it } from 'vitest';
import { GET as rawRoute } from '@/app/a/[id]/raw/route';
import { POST as createArtifactRoute } from '@/app/api/artifacts/route';


import { mintToken } from '@/lib/tokens';
import { request, useAppHarness } from '@/__tests__/harness';

useAppHarness();

const BASE = 'http://localhost:3000';
const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });
const create = async (token: string, markup: string, template: 'editorial' | 'scrolly' = 'editorial') => {
  const res = await createArtifactRoute(request('/api/artifacts', { method: 'POST', token, json: { markup, template } }));
  expect(res.status, await res.clone().text()).toBe(201);
  return ((await res.json()) as { id: string }).id;
};
const SECTIONED = '<article data-design="tw" className="mx-auto max-w-2xl">'
  + ['Why', 'How', 'Limits'].map((t, i) => `<section><h2 className="text-2xl font-semibold">${i + 1}. ${t}</h2><p>text</p></section>`).join('')
  + '<table><thead><tr><th>a</th></tr></thead><tbody><tr><td>1</td></tr></tbody></table></article>';

describe('the served document', () => {
  it('carries the outline rail in its SSR body, and the table rules in its head', async () => {
    const t = await mintToken('t');
    const id = await create(t.token, SECTIONED);
    const html = await (await rawRoute(request(`/a/${id}/raw`, { token: t.token }), params({ id }))).text();
    expect(html).toContain('class="mx-outline"');
    expect(html).toContain('Go to section 2: 2. How');
    expect(html).toMatch(/\.mx-outline\s*\{[^}]*padding:\s*56px 20px 36px 24px/s);
    expect(html).toMatch(/:where\(\[data-mx-story-root\]\) table\s*\{/);
  });

  it('a CAPTURE has no outline — it would land in every og card', async () => {
    const t = await mintToken('t');
    const id = await create(t.token, SECTIONED);
    const html = await (await rawRoute(request(`/a/${id}/raw?chrome=0`, { token: t.token }), params({ id }))).text();
    expect(html).not.toContain('mx-outline');
  });

  it('a SCROLLY with the same sections has no outline', async () => {
    const t = await mintToken('t');
    const id = await create(t.token, SECTIONED, 'scrolly');
    const html = await (await rawRoute(request(`/a/${id}/raw`, { token: t.token }), params({ id }))).text();
    expect(html).not.toContain('class="mx-outline"');
  });
});
