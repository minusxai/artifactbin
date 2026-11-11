/**
 * AN EXPORT PUBLISHED AGAIN IS ITS SOURCE, NEVER ITS ROWS: a downloaded copy carries its reader's rows
 * (`data-af="offline-data"`) and the engine that reads them (`data-af="offline-sql"`), and no server path stores
 * either. Create, replace and preflight reduce a verified export to the source it carries (lib/operations
 * authoredHtml) and refuse one that no longer verifies; canonicalizeHtmlPage (lib/html-page) refuses either block in
 * any source, hand-written or carried. The new page reads its datasets live, under its own readers.
 * This file: create from an export, and the blocks written by hand; replace, preflight and the unverifiable export
 * are in offline-export-republish-replace.test.ts (split for the CI shards; one fixture, ./offline-export-fixture.ts).
 */
import { beforeEach, expect, it } from 'vitest';
import { setSession, useAppHarness } from './harness';
import { getArtifactById } from '@/lib/artifacts';
import { portableScript } from '@/lib/html-runtime/portable';
import { portableRenderedDigest } from '@/lib/html-runtime/portable-source';
import { fixture, sql } from './page-sql-door-fixture';
import { SECRET, GENERATED, exportedPage, post, put, refusedWith } from './offline-export-fixture';

useAppHarness();
beforeEach(() => setSession(null));

it('creating a page from an export stores the page\'s source, and the page reads its datasets live as its own readers may', async () => {
  const f = await exportedPage();
  const original = (await getArtifactById(f.page))!.source!;
  const made = await post(f.owner, { html: f.html });
  expect(made.status, JSON.stringify(made.body)).toBe(201);
  const source = (await getArtifactById(made.body.id))!.source!;
  expect(source).not.toMatch(GENERATED);
  expect(source).not.toContain(SECRET);
  expect(source).toBe(original);
  // Live, not frozen: a row added after the export is read through the new page.
  expect((await sql(made.body.id, f.owner, "insert into staff (name, team) values ('cy', 'red')")).status).toBe(200);
  expect((await sql(made.body.id, f.owner, 'select name from staff order by name')).body.rows).toEqual([{ name: 'ada' }, { name: 'bo' }, { name: 'cy' }]);
  // Under the new page's readers: the viewer's role view, and an anonymous reader of the public page reads no secret.
  expect((await sql(made.body.id, f.viewer, 'select name from staff order by name')).body.rows).toEqual([{ name: 'ada' }, { name: 'cy' }]);
  const anonymous = await sql(made.body.id, null, 'select code from secret');
  expect(anonymous.body.rows).toBeUndefined();
  expect(JSON.stringify(anonymous.body)).not.toContain(SECRET);
});


it('refuses either block written by hand into ordinary HTML, or carried inside an envelope, on create and replace', async () => {
  const f = await fixture();
  const page = (block: string) => `<!doctype html><html><head><title>Hand</title>${block}</head><body><p>Hand made</p></body></html>`;
  const data = page('<script type="application/json" data-af="offline-data">{"tables":[{"schema":"main","name":"staff","columns":[],"rows":[]}]}</script>');
  const engine = page('<template><script type="application/json" data-af="offline-sql">"export {}"</script></template>');
  for (const html of [data, engine]) {
    expect(await refusedWith('invalid_html', () => post(f.owner, { html }))).toMatch(/exported copy/);
    expect(await refusedWith('invalid_html', () => put(f.owner, f.page, { html }))).toMatch(/exported copy/);
  }
  // An envelope is no way around it: one that verifies (its digest names the file around it) carries a source that is
  // checked as any source is.
  const plain = page('');
  const carried = plain.replace('<head>', '<head>' + portableScript({ version: 1, source: data, renderedDigest: portableRenderedDigest(plain) }));
  expect(await refusedWith('invalid_html', () => post(f.owner, { html: carried }))).toMatch(/offline-data/);
  expect((await getArtifactById(f.page))!.source).not.toMatch(GENERATED);
});
