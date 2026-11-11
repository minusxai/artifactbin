/**
 * AN EXPORT PUBLISHED AGAIN IS ITS SOURCE, NEVER ITS ROWS (offline-export-republish.test.ts): replacing a page with an
 * export, or checking one first, stores and answers the source only, and an export that no longer verifies is refused
 * with nothing stored.
 */
import { beforeEach, expect, it } from 'vitest';
import { request, setSession, useAppHarness } from './harness';
import { getArtifactById } from '@/lib/artifacts';
import { POST as preflight } from '@/app/api/artifacts/preflight/route';
import { SECRET, GENERATED, exportedPage, post, put, refusedWith } from './offline-export-fixture';

useAppHarness();
beforeEach(() => setSession(null));

it('replacing a page with an export, or checking one first, stores and answers the source only', async () => {
  const f = await exportedPage();
  const other = await post(f.owner, { html: '<!doctype html><html><head><title>Old</title></head><body>Old</body></html>' });
  const replaced = await put(f.owner, other.body.id, { html: f.html });
  expect(replaced.status, JSON.stringify(replaced.body)).toBe(200);
  const source = (await getArtifactById(other.body.id))!.source!;
  expect(source).not.toMatch(GENERATED);
  expect(source).not.toContain(SECRET);
  expect(source).toContain('<table id="staff"');
  const checked = await preflight(request('/api/artifacts/preflight', { method: 'POST', token: f.owner.token, json: { input: { html: f.html } } }));
  expect(checked.status, await checked.clone().text()).toBe(200);
});

it('refuses an export edited outside its envelope, or one whose envelope is unreadable, and stores nothing', async () => {
  const f = await exportedPage();
  const at = f.html.lastIndexOf('</body>');
  const edited = f.html.slice(0, at) + '<p>edited on disk</p>' + f.html.slice(at);
  expect(await refusedWith('portable_copy_unverified', () => post(f.owner, { html: edited }))).toMatch(/publish the original source.*export the page again/);
  expect(await refusedWith('portable_copy_unverified', () => put(f.owner, f.page, { html: edited }))).toMatch(/export the page again/);
  const unreadable = '<!doctype html><html><head><title>x</title><script type="application/json" data-af="portable">{not json</script></head><body>x</body></html>';
  await refusedWith('portable_copy_unverified', () => post(f.owner, { html: unreadable }));
  expect((await getArtifactById(f.page))!.source).not.toContain('edited on disk');
});
