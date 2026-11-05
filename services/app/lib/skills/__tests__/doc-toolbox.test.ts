/**
 * scripts/doc.mjs, the live-docs command, against a recorded server: read saves people's typing first and writes the
 * text with its baseline; write sends the edited file from the version read with an Idempotency-Key, rewrites the
 * pair with the merged text, resumes an unknown outcome with the same key (never a second write), and explains its
 * refusals in its own terms.
 */
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {afterEach, beforeEach, expect, it} from 'vitest';

const server = 'https://example.test';
type Seen = {method: string; path: string; body?: Record<string, unknown>; key?: string};
let root: string, seen: Seen[], answer: (seen: Seen) => Response | 'lose';

beforeEach(async () => { root = await mkdtemp(path.join(tmpdir(), 'doc-toolbox-')); seen = []; });
afterEach(async () => { await rm(root, {recursive: true, force: true}); });

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

it('read saves typing first, then writes the Markdown and its baseline; write sends it back and rewrites both', async () => {
  const file = path.join(root, 'doc.md');
  answer = ({method, path: route}) => {
    if (method === 'POST' && route === '/api/artifacts/PAGE12/regions/flush') return Response.json({version: 4});
    if (method === 'GET') return Response.json({regionId: 'body', kind: 'rich', version: 4, markdown: '# Plan\n\nShip.'});
    return Response.json({regionId: 'body', kind: 'rich', version: 5, html: '<h1>Plan</h1><p>Ship Friday.</p><p>Typed by Ada.</p>', markdown: '# Plan\n\nShip Friday.\n\nTyped by Ada.'});
  };
  const read = await run('read', ['PAGE12'], {output: file});
  expect(read).toMatchObject({id: 'PAGE12', regionId: 'body', version: 4, outputOwned: true});
  expect(seen.map((r) => `${r.method} ${r.path}`)).toEqual(['POST /api/artifacts/PAGE12/regions/flush', 'GET /api/artifacts/PAGE12/regions/_doc?format=markdown']);
  expect(await readFile(file, 'utf8')).toBe('# Plan\n\nShip.\n');
  expect(JSON.parse(await readFile(file + '.af.json', 'utf8'))).toEqual({kind: 'region-baseline', schema: 1, server, id: 'PAGE12', regionId: 'body', regionKind: 'rich', format: 'markdown', version: 4});
  expect(await readFile(file + '.af.json', 'utf8')).not.toContain('private-fixture');

  await writeFile(file, '# Plan\n\nShip Friday.\n');
  seen = [];
  const written = await run('write', [file]);
  expect(written).toMatchObject({id: 'PAGE12', regionId: 'body', version: 5, next: expect.stringContaining('reply to the user, and run the comment watch as a separate step')});
  expect(seen).toHaveLength(1);
  expect(seen[0]).toMatchObject({method: 'PUT', path: '/api/artifacts/PAGE12/regions/body', body: {markdown: '# Plan\n\nShip Friday.\n', base_version: 4}, key: expect.stringMatching(/^[A-Za-z0-9_-]{16,128}$/)});
  expect(await readFile(file, 'utf8')).toBe('# Plan\n\nShip Friday.\n\nTyped by Ada.\n');
  expect(JSON.parse(await readFile(file + '.af.json', 'utf8'))).toMatchObject({version: 5});
  expect(JSON.parse(await readFile(file + '.af.json', 'utf8'))).not.toHaveProperty('pending');
});

it('a reader reads the saved text (its save is refused); --html reads HTML of a named region', async () => {
  answer = ({method}) => (method === 'POST' ? Response.json({error: 'not_found'}, {status: 404}) : Response.json({regionId: 'title', kind: 'text', version: 2, html: 'Title'}));
  expect(await run('read', ['PAGE12'], {region: 'title', html: true})).toEqual({regionId: 'title', kind: 'text', version: 2, html: 'Title'});
  expect(seen.at(-1)!.path).toBe('/api/artifacts/PAGE12/regions/title?format=html');
  await expect(run('read', ['PAGE12'], {region: 'not a region'})).rejects.toMatchObject({code: 'invalid_region', exit: 2});
});

it('an unknown write outcome stays pending and the next write resumes it with the same key, never writing twice', async () => {
  const file = path.join(root, 'doc.md');
  await writeFile(file, 'Edited.\n');
  await writeFile(file + '.af.json', JSON.stringify({kind: 'region-baseline', schema: 1, server, id: 'PAGE12', regionId: '_doc', regionKind: 'rich', format: 'markdown', version: 3}));
  answer = () => 'lose';
  await expect(run('write', [file])).rejects.toMatchObject({code: 'outcome_unknown', exit: 5});
  const pending = JSON.parse(await readFile(file + '.af.json', 'utf8')).pending;
  expect(pending).toEqual(expect.any(String));
  await writeFile(file, 'Edited again meanwhile.\n');
  answer = () => Response.json({regionId: 'body', kind: 'rich', version: 4, html: '<p>Edited.</p>', markdown: 'Edited.'});
  expect(await run('write', [file])).toMatchObject({version: 4, resumed: true});
  const puts = seen.filter((r) => r.method === 'PUT');
  expect(new Set(puts.map((r) => r.key)).size).toBe(1);
  expect(puts.every((r) => r.body?.markdown === 'Edited.\n')).toBe(true);
  expect(JSON.parse(await readFile(file + '.af.json', 'utf8'))).toMatchObject({version: 4});
});

it('refusals say what to do: ambiguous region (exit 2, lists ids), stale version (exit 4, read again), unsupported content (exit 2)', async () => {
  answer = ({method}) => (method === 'POST' ? Response.json({version: 1}) : Response.json({error: 'region_ambiguous', regions: [{regionId: 'a', kind: 'rich'}, {regionId: 'b', kind: 'rich'}]}, {status: 409}));
  await expect(run('read', ['PAGE12'])).rejects.toMatchObject({code: 'region_ambiguous', exit: 2, recovery: expect.stringContaining('a, b')});
  const file = path.join(root, 'doc.md');
  await writeFile(file, 'x\n');
  const pair = {kind: 'region-baseline', schema: 1, server, id: 'PAGE12', regionId: 'a', regionKind: 'rich', format: 'markdown', version: 1};
  await writeFile(file + '.af.json', JSON.stringify(pair));
  answer = () => Response.json({error: 'region_snapshot_missing', version: 9}, {status: 409});
  await expect(run('write', [file])).rejects.toMatchObject({code: 'region_snapshot_missing', exit: 4, recovery: expect.stringContaining('doc.mjs read')});
  expect(JSON.parse(await readFile(file + '.af.json', 'utf8'))).not.toHaveProperty('pending');
  answer = () => Response.json({error: 'unsupported_content', details: ['<img>']}, {status: 422});
  await expect(run('write', [file])).rejects.toMatchObject({code: 'unsupported_content', exit: 2, details: {details: ['<img>']}});
  await writeFile(file + '.af.json', '{}');
  await expect(run('write', [file])).rejects.toMatchObject({code: 'invalid_baseline', exit: 2});
});
