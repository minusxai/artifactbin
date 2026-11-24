/** Byte comparison of publish responses, saved heads, archived versions and reserved node IDs. */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { expect, it } from 'vitest';
import { artifactState } from '@/lib/artifacts';
import { PUT as replace } from '@/app/api/artifacts/[id]/route';
import { head, postArtifact, sql } from './artifact-fixtures';
import { nativeHtml } from './native-html-fixture';
import { params, request, useAppHarness } from './harness';
import { person } from './page-sql-door-fixture';
import baseline from './publish-html-equivalence.expected.json';

useAppHarness();

async function put(token: string, id: string, html: string) {
  const row = await head(id);
  return replace(request(`/api/artifacts/${id}`, {
    method: 'PUT', token, json: { html, expectedVersion: row.version, expectedState: artifactState(row) },
  }), params(id));
}

const page = (head: string, body = '<p>Page</p>') =>
  nativeHtml(body).replace('</head>', () => head + '</head>');
const core = '<script src="/af/core.js"></script>';
const dataset = (name: string, href: string, extra = '') =>
  `<link rel="af-dataset" data-af-name="${name}" href="${href}" ${extra}>`;
const query = (name: string, link: string, sql: string, extra = '') =>
  `<script type="application/sql" data-af-query="${name}" data-af-dataset="${link}" ${extra}>${sql}</script>`;
const preview = (value: string) => `<meta name="artifactbin:og-image" content="${value}">`;
const csp = (name: string, value: string) => `<meta name="csp-${name}" content="${value}">`;
const examples = new URL('../skills/artifactbin/examples/', import.meta.url);

it('preserves HTML create and replace receipts and every stored publication field', async () => {
  const actor = await person('html_equivalence');
  const create = async (id: string, body: Record<string, unknown>) => {
    await sql('INSERT INTO artifact_id_registry(id,owner) VALUES($1,$2)', [id, actor.userId]);
    return postArtifact(actor.token, { reserved_id: id, ...body });
  };
  const data = await create('Data01', {dataset: [{amount: 1}]});
  expect(data.status, await data.clone().text()).toBe(201);
  expect((await create('Image1', {image: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWg0AAAAASUVORK5CYII='})).status).toBe(201);
  const cases: Record<string, string> = {
    ...Object.fromEntries(readdirSync(examples).filter(name => name.endsWith('.html')).sort().map(name =>
      [name, readFileSync(new URL(name, examples), 'utf8')])),
    plain: page(core),
    fragment: '<title>Fragment &amp; text</title><p>Résumé ☕</p>',
    implied: '<!doctype html><html><head><title>Implied body</title></head><p>Body</p>',
    crlf: page('\r\n  <title>Crlf</title>\r\n  ').replace('<body>', '\r\n<body>'),
    bom: '\uFEFF' + page(core),
    malformed: page('<title>Misnest</title>', '<b><i>nested</b> again</i><table>text<tr><td>x</table>'),
    noFormatting: page('', '<p>x <b>a</b><i>b</i></p>'),
    templates: page(core, '<template><div><template><b>x</b></template></div></template><p>body</p>'),
    foreign: page(core, '<svg viewBox="0 0 100 100"><use xlink:href="#sprite"/></svg><math><mi>x</mi></math>'),
    retained: page('', '<script data-af="core" async src="/af/core.js" data-af-id="fixed"></script><p data-af-id="note">Body</p>'),
    duplicateCore: page('<script defer src="/af/core.js"></script>'+core, '<template><script data-af="core"></script></template>'),
    design: page('<link rel="stylesheet" data-af="design-system" href="/af/systems.css"><meta name="artifactbin:design-system" content="default">').replace('<html>', '<html data-af-dark data-af-design-system="default">'),
    meta: page('<title> A &amp;  B </title><meta name="DESCRIPTION" content=" first "><meta name="description" content="second">'),
    pwa: page(['enabled=true', 'name=App Name', 'short-name=App', 'icon=ref:Image1', 'theme-color=#aAbBcC', 'background-color=#123456'].map(entry => {
      const [name, value] = entry.split('=');
      return `<meta name="artifactbin:pwa-${name}" content="${value}">`;
    }).join('')),
    csp: page(csp('connect', 'https://example.test')+csp('img', 'https://images.example.test')),
    badCsp: page(csp('connect', '*')),
    duplicateCsp: page(csp('connect', 'https://example.test')+csp('connect', 'https://other.example.test')),
    fakeHead: page(core, preview('invalid')+'<meta name="description" content="body">'),
    social: page(preview('ref:Image1')),
    socialLast: page(preview('broken')+preview('ref:Image1')),
    socialBad: page(preview('https://example.test/image.png')),
    socialMissing: page(preview('ref:NoSuch')),
    assets: page(core, '<img src="ref:Image1"><a href="ref:Image1">image</a><video poster="https://example.test/poster"></video><source src="https://example.test/a">'),
    assetMissing: page(core, '<img src="ref:NoSuch">'),
    templateAsset: page('', '<template><img src="ref:NoSuch"></template>'),
    dataset: page(dataset('sales', 'ref:Data01')+query('totals', 'sales', 'select amount from rows')),
    pinnedDataset: page(dataset('sales', 'ref:Data01', 'data-af-mode="pinned" data-af-revision="1"')),
    defaultConnection: page(dataset('finance', 'default:warehouse/finance')+query('total', 'finance', 'select 1', `data-af-params='{"month":"text","year":[2025,2026]}'`)),
    defaultBad: page(dataset('bad', 'default:select *')),
    datasetBad: page(dataset('bad name', 'ref:Data01')),
    datasetMissing: page(dataset('sales', 'ref:NoSuch')),
    duplicateDataset: page(dataset('sales', 'ref:Data01')+dataset('sales', 'ref:Data01')),
    strippedDataset: page(dataset('stripped', 'ref:Data01', 'data-af="design-system"')),
    strippedInvalidDataset: page(dataset('invalid name', 'ref:Data01', 'data-af="design-system"')),
    templateDataset: page('', '<template>'+dataset('hidden', 'ref:Data01')+'</template>'),
    queryBad: page(query('bad-name', 'sales', 'select 1')),
    queryDuplicate: page(query('same', 'sales', 'select 1')+query('same', 'sales', 'select 2')),
    queryBadParams: page(query('same', 'sales', 'select 1', 'data-af-params="[]"')),
    legacy: page('', '<section data-af-editable="rich"><p data-af-id="p-one"><strong data-af-id="bold-one">Text</strong></p></section>'),
    textRegion: page('', '<section data-af-editable="text">Text</section>'),
    nativeRegion: page('', '<section data-af-editable="rich-native-v1"><p>Text</p></section>'),
    repeatedId: page('', '<p data-af-id="repeat">One</p><p data-af-id="repeat">Two</p>'),
    invalidId: page('', '<p data-af-id="5bad">One</p>'),
    offline: page('<script data-af="offline-data">[]</script>'),
    offlineEngine: page('<script data-af="offline-sql"></script>'),
    malformedPortable: page('<script data-af="&#112;ortable">oops</script>'),
    relativeUrl: page('', '<a href="notes.md">Notes</a>'),
    missingFile: page('', '<img src="missing.png">'),
  };

  function stableRow(row: Record<string, unknown>) {
    const { created_at, updated_at, document_archived_at, edit_id, user_id, token_id, actor_user_id, actor_token_id, creator_user_id, ...stable } = row;
    return {...stable, archived: document_archived_at != null, identities: [user_id, token_id, actor_user_id, actor_token_id, creator_user_id].map(value => value === undefined ? 'absent' : value !== null)};
  }
  async function receipt(response: Response, id: string) {
    const body = (await response.text()).replaceAll(actor.userId!, '<user>').replaceAll(actor.id, '<token>');
    const row = (await sql('SELECT * FROM artifacts WHERE id=$1', [id]))[0];
    const versions = (await sql('SELECT * FROM artifact_versions WHERE artifact_id=$1 ORDER BY version', [id])).map(stableRow);
    const ids = await sql('SELECT source_id, provenance, first_version, retired_version FROM artifact_source_ids WHERE artifact_id=$1 ORDER BY source_id', [id]);
    // The wire state and edit ID are per write. Mask just these values on the original response text.
    const encoded = row ? body.replaceAll(String(row.edit_id), '<edit>').replaceAll(artifactState(row as unknown as Awaited<ReturnType<typeof head>>), '<state>') : body;
    return JSON.stringify([response.status, encoded, row ? stableRow(row) : null, versions, ids]);
  }
  const actual: Record<string, string[]> = {};
  for (const [name, html] of Object.entries(cases)) {
    const i = Object.keys(actual).length.toString().padStart(3, '0');
    const id = 'Page'+i, target = 'Seed'+i;
    const created = await create(id, {html});
    const seeded = await create(target, {html:page(core,'<p>Seed</p>')});
    expect(seeded.status, await seeded.clone().text()).toBe(201);
    actual[name] = [await receipt(created, id), await receipt(await put(actor.token, target, html), target)];
    if (created.status === 201) actual[name]!.push(await receipt(await put(actor.token, id, html + '<!-- revision -->'), id));
  }
  // Hash the exact normalized bytes to keep the original receipts out of the test fixture.
  expect(Object.keys(actual)).toEqual(Object.keys(baseline));
  for (const [name, expected] of Object.entries(baseline)) {
    const digest = createHash('sha256').update(JSON.stringify(actual[name])).digest('hex');
    expect(digest, name).toBe(expected);
  }
}, 45_000);
