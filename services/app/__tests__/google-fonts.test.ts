/**
 * Google Fonts, the CSS way — end to end through the real doors.
 *
 * A document asks for a face with Helmet metadata (`<meta name="font-display" content="Lobster">`).
 * The publish checks only the NAME (it lands in a stylesheet): nothing is fetched and nothing is stored.
 * The served document's font sheet opens with Google Fonts' `@import`, which its policy admits
 * (`style-src`/`font-src` name fonts.googleapis.com and fonts.gstatic.com, lib/__tests__/document-csp).
 * A bundled family is served from this origin by the theme sheet and imports nothing.
 */
import { describe, expect, it } from 'vitest';
import { GET as rawRoute } from '@/app/a/[id]/raw/route';
import { POST as createArtifact } from '@/app/api/artifacts/route';
import { mintToken } from '@/lib/accounts';
import { getDb } from '@/lib/platform/db';
import { useAppHarness, request } from '@/__tests__/harness';

useAppHarness();

const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });
const IMPORT = '@import url(https://fonts.googleapis.com/css2?family=Lobster:ital,wght@0,400;0,700;1,400&display=swap);';

async function publish(markup: string): Promise<{ status: number; id: string; body: Record<string, unknown> }> {
  const t = await mintToken('t');
  const res = await createArtifact(request('/api/artifacts', { method: 'POST', token: t.token, json: { markup } }));
  const body = await res.json() as Record<string, unknown>;
  return { status: res.status, id: String(body.id), body };
}

const served = async (id: string) => (await rawRoute(request(`/a/${id}/raw`), params({ id }))).text();
/** The font sheet's text, exactly as the document carries it. */
const fontSheet = (html: string) => /<style data-mx-font-vars>([\s\S]*?)<\/style>/.exec(html)?.[1] ?? null;

describe('a document asks for a Google font by Helmet metadata', () => {
  it('publishes without fetching or storing a face, and the served font sheet opens with the import', async () => {
    const { status, id } = await publish(`<Helmet><title>Fonts</title><meta name="font-display" content="Lobster" /></Helmet>
<div className="p-8"><h1 className="text-4xl font-bold">Headlined</h1><p>body</p></div>`);
    expect(status).toBe(201);
    // No copy of anything: the publish stored no imported asset of any kind.
    const db = await getDb();
    expect((await db.query('SELECT 1 FROM web_assets')).rows).toHaveLength(0);

    const html = await served(id);
    const sheet = fontSheet(html);
    // `@import` is honoured only as the first rule of its stylesheet: the font sheet is its own <style>.
    expect(sheet?.startsWith(IMPORT), sheet ?? 'no font sheet').toBe(true);
    expect(sheet).toContain('--font-display: "Lobster"');
    expect(html).not.toContain('/webfonts/');
    // Nothing preloads a Google face: its files are named by Google's stylesheet.
    expect(html).not.toMatch(/rel="preload" href="https:\/\/fonts\./);
  });

  it('any well-formed family publishes: Google answers for the name, the publish never asks', async () => {
    const { status } = await publish('<Helmet><meta name="font-display" content="Not A Real Font" /></Helmet><p>x</p>');
    expect(status).toBe(201);
  });

  it('a malformed family name is still refused by name: it would land in a stylesheet', async () => {
    const { status, body } = await publish('<Helmet><meta name="font-body" content="Inter; } body { display: none } .x {" /></Helmet><p>x</p>');
    expect(status).toBe(400);
    expect(body.error).toBe('unknown_font');
  });

  it('a BUNDLED family imports nothing: the override var is the whole change', async () => {
    const { status, id } = await publish('<Helmet><meta name="font-body" content="JetBrains Mono" /></Helmet><p>mono body</p>');
    expect(status).toBe(201);
    const html = await served(id);
    expect(html).toContain('--font-body: "JetBrains Mono"');
    expect(html).not.toContain('fonts.googleapis.com/css2');
  });
});
