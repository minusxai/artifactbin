import { execFile } from 'node:child_process';
import { existsSync, globSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import os from 'node:os';
import { promisify } from 'node:util';
import { crc32 } from 'node:zlib';
import path from 'node:path';
import { describe, expect, it, onTestFinished } from 'vitest';
import { LANE_LISTS, NODE_BATCH_EXCLUDED, NODE_BATCH_GUARDED, NODE_BATCH_MAX_MS, NODE_TIMINGS_ARTIFACT, laneFiles, measuredArtifact, nodeBatchFiles, withMeasuredTimes } from '../lib/node-batch.mjs';
import { LEAKS_PAST_ITS_FILE } from '../lib/test-isolation.mjs';
import full from '../../vitest.config.ts';
import batch from '../../vitest.node-batch.config.ts';
import {tempDirSync} from '../../services/test-support/src/temp-dir.ts';

const root = path.resolve(import.meta.dirname, '../..');
const [guarded] = NODE_BATCH_GUARDED;
const [excluded] = Object.keys(NODE_BATCH_EXCLUDED);

describe('pr fast\'s node batch', () => {
  it('always includes PostgreSQL viewer setup and native cancellation regressions', () => {
    const files = batch.test.projects[0].test.include;
    for (const file of ['connectors', 'postgres-cancel-wire', 'postgres-operation']) {
      expect(files).toContain(`services/connectors/__tests__/${file}.test.ts`);
    }
  });

  it('takes the cheap recorded node files no other list runs and that leave nothing behind, and the guarded ones', () => {
    const timings = { files: { node: { 'cheap.test.ts': 40, 'slow.test.ts': NODE_BATCH_MAX_MS, 'mocks.test.ts': 10, 'listed.test.ts': 10, [excluded]: 10, [guarded]: 5000 }, 'node-batch': { 'moved.test.ts': 30 } } };
    const text = { 'mocks.test.ts': "vi.mock('x')", 'env.test.ts': 'process.env.X = "1"' };
    const files = nodeBatchFiles({
      timings,
      candidates: ['cheap.test.ts', 'slow.test.ts', 'mocks.test.ts', 'listed.test.ts', excluded, guarded, 'moved.test.ts', 'unrecorded.test.ts'],
      lane: new Set(['listed.test.ts']),
      read: (file) => text[file] ?? '',
    });
    expect(files).toEqual(['cheap.test.ts', 'moved.test.ts', guarded].sort());
  });

  it('runs only `node` project files (so the full suite still runs each), none excluded, none another list runs', () => {
    const node = full.test.projects.find((project) => project.test?.name === 'node').test;
    const nodeFiles = new Set(globSync(node.include, { cwd: root, exclude: node.exclude }).map((file) => file.split(path.sep).join('/')));
    const [project] = batch.test.projects;
    expect(project.test.name).toBe('node-batch');
    expect(project.test.isolate).toBe(false);
    const files = project.test.include;
    expect(files.length).toBeGreaterThan(100);
    expect(files.filter((file) => !nodeFiles.has(file))).toEqual([]);
    const lane = laneFiles(root);
    expect(LANE_LISTS.map((list) => existsSync(path.join(root, 'scripts/ci', list)))).toEqual(LANE_LISTS.map(() => true));
    expect(files.filter((file) => lane.has(file) || Object.hasOwn(NODE_BATCH_EXCLUDED, file) || LEAKS_PAST_ITS_FILE.test(readFileSync(path.join(root, file), 'utf8')))).toEqual([]);
    for (const file of NODE_BATCH_GUARDED) expect(files, file).toContain(file);
    // Every named file still exists: a stale entry would silently stop meaning anything.
    for (const file of [...NODE_BATCH_GUARDED, ...Object.keys(NODE_BATCH_EXCLUDED)]) expect(existsSync(path.join(root, file)), file).toBe(true);
    // The batch takes the shared-graph check after the full suite's setup.
    expect(project.test.setupFiles).toEqual(['./services/app/test/setup/vitest.setup.ts', './services/app/test/setup/shared-graph.setup.ts']);
  });

  // MAIN MEASURES THE BATCH (.github/workflows/node-timings.yml): a file the committed table never timed joins once main's
  // full suite has measured it under the cut, and no measurement takes a file out of the lane.
  it('joins a file main measured under the cut, keeps out one it measured slow, and never drops one already in', () => {
    const timings = { files: { node: { 'in.test.ts': 40, 'over.test.ts': 900, 'stays.test.ts': 20 }, 'node-batch': { 'lens.test.ts': 30 }, api: { 'moved.test.ts': 5000 } } };
    const measured = { runs: ['1', '2'], files: { node: { 'new.test.ts': 12, 'slow-new.test.ts': 4000, 'in.test.ts': 818, 'over.test.ts': 60, 'lens.test.ts': 9000, 'moved.test.ts': 30, 'stays.test.ts': 25 } } };
    const merged = withMeasuredTimes(timings, measured);
    const choose = (table) => nodeBatchFiles({ timings: table, candidates: ['in.test.ts', 'over.test.ts', 'stays.test.ts', 'lens.test.ts', 'moved.test.ts', 'new.test.ts', 'slow-new.test.ts', 'unmeasured.test.ts'], lane: new Set(), read: () => '' });
    expect(choose(timings)).toEqual(['in.test.ts', 'lens.test.ts', 'stays.test.ts']);
    // Joined: new (never timed), over (now cheap), moved (now a node file). Kept: in and lens, measured slow. Out: the slow new one, the unmeasured one.
    expect(choose(merged)).toEqual(['in.test.ts', 'lens.test.ts', 'moved.test.ts', 'new.test.ts', 'over.test.ts', 'stays.test.ts']);
    expect(merged.files.node).toMatchObject({ 'in.test.ts': 40, 'over.test.ts': 60, 'stays.test.ts': 25, 'new.test.ts': 12, 'slow-new.test.ts': 4000, 'moved.test.ts': 30 });
    expect(merged.files.api).toEqual({});
    expect(merged.files['node-batch']).toEqual({ 'lens.test.ts': 30 });
    // The committed table is left as it was.
    expect(timings.files.node['in.test.ts']).toBe(40);
    expect(timings.files.api['moved.test.ts']).toBe(5000);
    expect(withMeasuredTimes(timings, {})).toEqual(timings);
    expect(() => withMeasuredTimes(timings, { files: { node: { 'x.test.ts': 'fast' } } })).toThrow(/not a duration/);
  });

  it('reads the newest live artifact main uploaded before the run began, never a branch\'s or a fork\'s', () => {
    const artifact = (id, created, run = {}) => ({ id, name: NODE_TIMINGS_ARTIFACT, expired: false, created_at: created, workflow_run: { id: id * 10, head_branch: 'main', repository_id: 7, head_repository_id: 7, ...run } });
    const artifacts = [
      artifact(1, '2026-11-17T10:00:00Z'),
      artifact(2, '2026-11-17T11:00:00Z'),
      artifact(3, '2026-11-17T11:30:00Z', { head_branch: 'feature' }),
      artifact(4, '2026-11-17T11:40:00Z', { head_repository_id: 8 }),
      { ...artifact(5, '2026-11-17T11:50:00Z'), expired: true },
      { ...artifact(6, '2026-11-17T11:55:00Z'), name: 'tsgo-buildinfo' },
      // Uploaded after the run began: a sibling runner may already have chosen without it.
      artifact(7, '2026-11-17T12:00:01Z'),
    ];
    expect(measuredArtifact(artifacts, '2026-11-17T12:00:00Z').id).toBe(2);
    expect(measuredArtifact([...artifacts].reverse(), '2026-11-17T12:00:00Z').id).toBe(2);
    expect(measuredArtifact(artifacts, '2026-11-17T12:00:01Z').id).toBe(7);
    expect(measuredArtifact(artifacts, '2026-11-17T09:00:00Z')).toBeNull();
    expect(measuredArtifact([], '2026-11-17T12:00:00Z')).toBeNull();
    expect(() => measuredArtifact(artifacts, undefined)).toThrow(/not a time/);
  });

  // scripts/ci/ci.mjs `node-timings`, as a node runner runs it, against a stand-in for the GitHub API.
  it('lays the chosen artifact over the checkout\'s table on a runner, leaves it alone when none exists, and fails loud otherwise', async () => {
    const created = '2026-11-17T12:00:00Z';
    let listing = [];
    let broken = false;
    const measured = { runs: ['501', '502'], files: { node: { 'new.test.ts': 12, 'in.test.ts': 900 } } };
    const server = createServer((request, response) => {
      const url = new URL(request.url, 'http://x');
      const send = (status, body, type = 'application/json') => { response.writeHead(status, { 'content-type': type }); response.end(body); };
      if (broken || request.headers.authorization !== 'Bearer t') return send(503, '{}');
      if (url.pathname === '/repos/o/r/actions/runs/42') return send(200, JSON.stringify({ id: 42, created_at: created }));
      if (url.pathname === '/repos/o/r/actions/artifacts' && url.searchParams.get('name') === NODE_TIMINGS_ARTIFACT) return send(200, JSON.stringify({ artifacts: listing }));
      if (url.pathname === '/repos/o/r/actions/artifacts/9/zip') return send(200, storedZip('node-timings.json', JSON.stringify(measured)), 'application/zip');
      send(404, '{}');
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const cwd = tempDirSync('node-timings-',onTestFinished);
    const table = path.join(cwd, 'scripts/ci/test-timings.json');
    mkdirSync(path.dirname(table), { recursive: true });
    const committed = { files: { node: { 'in.test.ts': 40 }, api: { 'a.test.ts': 3000 } } };
    writeFileSync(table, JSON.stringify(committed));
    const env = { PATH: process.env.PATH, GITHUB_API_URL: `http://127.0.0.1:${server.address().port}`, GITHUB_REPOSITORY: 'o/r', GH_TOKEN: 't', GITHUB_RUN_ID: '42' };
    const run = () => promisify(execFile)(process.execPath, [path.join(root, 'scripts/ci/ci.mjs'), 'node-timings'], { cwd, env, encoding: 'utf8' });
    const artifact = (id, at) => ({ id, name: NODE_TIMINGS_ARTIFACT, expired: false, created_at: at, workflow_run: { id: id * 100, head_branch: 'main', repository_id: 1, head_repository_id: 1 } });
    try {
      expect((await run()).stdout).toMatch(/No node-batch-timings uploaded on main before 2026-11-17T12:00:00Z/);
      expect(JSON.parse(readFileSync(table, 'utf8'))).toEqual(committed);

      listing = [artifact(10, '2026-11-17T12:00:05Z'), artifact(9, '2026-11-17T11:00:00Z')];
      expect((await run()).stdout).toContain('Node batch chosen with 2 times main measured (runs 501, 502; artifact 9 of run 900');
      expect(JSON.parse(readFileSync(table, 'utf8'))).toEqual({ files: { node: { 'in.test.ts': 40, 'new.test.ts': 12 }, api: { 'a.test.ts': 3000 } } });

      broken = true;
      await expect(run()).rejects.toMatchObject({ stderr: expect.stringContaining('answered 503, twice') });
    } finally {server.close();}
  });
});

/** A one-entry zip archive, stored (as upload-artifact's are read by unzip). */
function storedZip(name, text) {
  const data = Buffer.from(text);
  const file = Buffer.from(name);
  const crc = crc32(data);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(file.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(data.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(file.length, 28);
  const end = Buffer.alloc(22);
  const centralAt = local.length + file.length + data.length;
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + file.length, 12); end.writeUInt32LE(centralAt, 16);
  return Buffer.concat([local, file, data, central, file, end]);
}
