/**
 * scripts/doc.mjs, the live-docs command, against a recorded server: read saves people's typing first and writes the
 * text under a first-line marker (page, region, version read); write sends the edited text (never the marker) from
 * the version read with an Idempotency-Key, rewrites the file with the merged text, resumes an unknown outcome with the same key (never a second write), and explains its
 * refusals in its own terms.
 */
import {mkdtemp, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {afterEach, beforeEach, expect, it} from 'vitest';

const server = 'https://example.test';
type Seen = {method: string; path: string; body?: Record<string, unknown>; key?: string};
let root: string, seen: Seen[], answer: (seen: Seen) => Response | 'lose';

beforeEach(async () => { root = await mkdtemp(path.join(tmpdir(), 'doc-toolbox-')); seen = []; });
afterEach(async () => { await rm(root, {recursive: true, force: true}); });

/** The first-line marker doc.mjs writes, and the file split into it and the text. */
const stamp = (marker: Record<string, unknown>, text: string) =>
  `<!-- af-doc:${Buffer.from(JSON.stringify(marker)).toString('base64url')} -->\n${text}`;
async function saved(file: string) {
  const [first, ...rest] = (await readFile(file, 'utf8')).split('\n');
  const marker = /^<!-- af-doc:([A-Za-z0-9_-]+) -->$/.exec(first!)?.[1];
  return {marker: marker && JSON.parse(Buffer.from(marker, 'base64url').toString()), text: rest.join('\n')};
}
const noCompanions = async () => expect((await readdir(root)).filter((name) => name.endsWith('.af.json'))).toEqual([]);

async function run(sub: 'read' | 'write', positionals: string[], values: Record<string, unknown> = {}) {
  const {docCommand} = await import('../../../skills/artifactbin/scripts/doc.mjs');
  const fetcher = async (url: unknown, init: RequestInit = {}) => {
    const {pathname, search} = new URL(String(url));
    const headers = (init.headers ?? {}) as Record<string, string>;
    const request: Seen = {method: init.method ?? 'GET', path: pathname + search, ...(init.body ? {body: JSON.parse(String(init.body))} : {}), ...(headers['Idempotency-Key'] ? {key: headers['Idempotency-Key']} : {})};
    seen.push(request);
    const response = answer(request);
    if (response === 'lose') throw new Error('socket hang up');
    return response;
  };
  const options = {env: {ARTIFACTBIN_URL: server, ARTIFACTBIN_TOKEN: 'private-fixture', ARTIFACTBIN_HOME: path.join(root, 'home')}, fetcher, retryDelays: []};
  return docCommand({sub, values: {server, ...values}, positionals}, options);
}

it('read saves typing first, then writes the Markdown under its marker; write sends the text back and rewrites the file', async () => {
  const file = path.join(root, 'doc.md');
  answer = ({method, path: route}) => {
    if (method === 'POST' && route === '/api/artifacts/PAGE12/regions/flush') return Response.json({version: 4});
    if (method === 'GET') return Response.json({regionId: 'body', kind: 'rich', version: 4, markdown: '# Plan\n\nShip.'});
    return Response.json({regionId: 'body', kind: 'rich', version: 5, html: '<h1>Plan</h1><p>Ship Friday.</p><p>Typed by Ada.</p>', markdown: '# Plan\n\nShip Friday.\n\nTyped by Ada.'});
  };
  const read = await run('read', ['PAGE12'], {output: file});
  expect(read).toMatchObject({id: 'PAGE12', regionId: 'body', version: 4, outputOwned: true});
  expect(seen.map((r) => `${r.method} ${r.path}`)).toEqual(['POST /api/artifacts/PAGE12/regions/flush', 'GET /api/artifacts/PAGE12/regions/_doc?format=markdown']);
  const marker = {server, id: 'PAGE12', regionId: 'body', regionKind: 'rich', format: 'markdown', version: 4};
  expect(await saved(file)).toEqual({marker, text: '# Plan\n\nShip.\n'});
  expect(await readFile(file, 'utf8')).not.toContain('private-fixture');

  await writeFile(file, stamp(marker, '# Plan\n\nShip Friday.\n'));
  seen = [];
  const written = await run('write', [file]);
  expect(written).toMatchObject({id: 'PAGE12', regionId: 'body', version: 5, next: expect.stringContaining('reply to the user and run the comment watch')});
  expect(seen).toHaveLength(1);
  expect(seen[0]).toMatchObject({method: 'PUT', path: '/api/artifacts/PAGE12/regions/body', body: {markdown: '# Plan\n\nShip Friday.\n', base_version: 4}, key: expect.stringMatching(/^[A-Za-z0-9_-]{16,128}$/)});
  expect(await saved(file)).toEqual({marker: {...marker, version: 5}, text: '# Plan\n\nShip Friday.\n\nTyped by Ada.\n'});
  await noCompanions();
});

it('a reader reads the saved text (its save is refused); --html reads HTML of a named region', async () => {
  answer = ({method}) => (method === 'POST' ? Response.json({error: 'not_found'}, {status: 404}) : Response.json({regionId: 'title', kind: 'text', version: 2, html: 'Title'}));
  expect(await run('read', ['PAGE12'], {region: 'title', html: true})).toEqual({regionId: 'title', kind: 'text', version: 2, html: 'Title'});
  expect(seen.at(-1)!.path).toBe('/api/artifacts/PAGE12/regions/title?format=html');
  await expect(run('read', ['PAGE12'], {region: 'not a region'})).rejects.toMatchObject({code: 'invalid_region', exit: 2});
});

it('an unknown write outcome stays pending and the next write resumes it with the same key, never writing twice', async () => {
  const file = path.join(root, 'doc.md');
  const marker = {server, id: 'PAGE12', regionId: '_doc', regionKind: 'rich', format: 'markdown', version: 3};
  await writeFile(file, stamp(marker, 'Edited.\n'));
  answer = () => 'lose';
  await expect(run('write', [file])).rejects.toMatchObject({code: 'outcome_unknown', exit: 5});
  const {marker: kept, text} = await saved(file);
  expect(kept.pending).toEqual(expect.any(String));expect(text).toBe('Edited.\n');
  await writeFile(file, stamp(kept, 'Edited again meanwhile.\n'));
  answer = () => Response.json({regionId: 'body', kind: 'rich', version: 4, html: '<p>Edited.</p>', markdown: 'Edited.'});
  expect(await run('write', [file])).toMatchObject({version: 4, resumed: true});
  const puts = seen.filter((r) => r.method === 'PUT');
  expect(new Set(puts.map((r) => r.key)).size).toBe(1);
  expect(puts.every((r) => r.body?.markdown === 'Edited.\n')).toBe(true);
  expect((await saved(file)).marker).toEqual({...marker, version: 4});
  await noCompanions();
});

it('refusals say what to do: ambiguous region (exit 2, lists ids), stale version (exit 4, read again), unsupported content (exit 2)', async () => {
  answer = ({method}) => (method === 'POST' ? Response.json({version: 1}) : Response.json({error: 'region_ambiguous', regions: [{regionId: 'a', kind: 'rich'}, {regionId: 'b', kind: 'rich'}]}, {status: 409}));
  await expect(run('read', ['PAGE12'])).rejects.toMatchObject({code: 'region_ambiguous', exit: 2, recovery: expect.stringContaining('a, b')});
  const file = path.join(root, 'doc.md');
  const marker = {server, id: 'PAGE12', regionId: 'a', regionKind: 'rich', format: 'markdown', version: 1};
  await writeFile(file, stamp(marker, 'x\n'));
  answer = () => Response.json({error: 'region_snapshot_missing', version: 9}, {status: 409});
  await expect(run('write', [file])).rejects.toMatchObject({code: 'region_snapshot_missing', exit: 4, recovery: expect.stringContaining('doc.mjs read')});
  expect((await saved(file)).marker).toEqual(marker);
  answer = () => Response.json({error: 'unsupported_content', details: ['<img>']}, {status: 422});
  await expect(run('write', [file])).rejects.toMatchObject({code: 'unsupported_content', exit: 2, details: {details: ['<img>']}});
  // Without its first line the file names no page: read again, never guess.
  await writeFile(file, 'x\n');
  await expect(run('write', [file])).rejects.toMatchObject({code: 'invalid_doc_marker', exit: 2,
    message: 'doc.md does not start with the marker line doc.mjs read wrote, so write cannot tell which doc it edits.',
    recovery: 'Read it again: node scripts/doc.mjs read ID --output fresh.md, reapply your edit there (below its first line) and write that file.'});
  await noCompanions();
});
