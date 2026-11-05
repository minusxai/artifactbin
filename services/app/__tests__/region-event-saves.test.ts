/**
 * Versions are saved on EVENTS (contract region-sessions): when the last editor stream of a page closes (after a
 * grace a reconnect fits in), and by the idle backstop, which the open streams drive: a region dirty and quiet for
 * REGION_IDLE_SAVE_MS is saved, one that is still being typed in is not, until it has been dirty for
 * REGION_MAX_UNSAVED_MS. Driven with a fake clock.
 */
import { afterEach, beforeEach, expect, it } from 'vitest';
import * as Y from 'yjs';
import { REGION_IDLE_SAVE_MS, REGION_MAX_UNSAVED_MS } from '@artifactbin/contracts';
import { createUser, identityForUser, type AccessActor } from '@/lib/accounts';
import { createArtifact, getArtifactById } from '@/lib/artifacts';
import { editableRegions, openRegionDoc, regionText } from '@/lib/live-regions';
import { createRegionSessions, type RegionSessions } from '@/lib/region-sessions';
import { getDb } from '@/lib/platform';
import { nativeHtml } from './native-html-fixture';
import { useAppHarness } from './harness';

useAppHarness();

const IDLE_CHECK_MS = 1234;
let now = Date.parse('2026-11-04T10:00:00.000Z');
let intervals: { work: () => void; ms: number }[] = [];
const clock = {
  now: () => now,
  setInterval: (work: () => void, ms: number) => { const timer = { work, ms }; intervals.push(timer); return timer; },
  clearInterval: (timer: unknown) => { intervals = intervals.filter((candidate) => candidate !== timer); },
  setTimeout: (work: () => void, ms: number) => setTimeout(work, ms),
  clearTimeout: (timer: unknown) => clearTimeout(timer as ReturnType<typeof setTimeout>),
};
const fireIdleChecks = () => { for (const timer of intervals.filter((candidate) => candidate.ms === IDLE_CHECK_MS)) timer.work(); };

let sessions: RegionSessions, owner: AccessActor, pageId: string, regionId: string;
const aborts: AbortController[] = [];

function instance(leaveGraceMs: number): RegionSessions {
  return createRegionSessions({
    db: getDb, keepaliveFrame: () => 'event: keepalive\ndata: {}\n\n', clock, idleCheckMs: IDLE_CHECK_MS, leaveGraceMs,
    subscribe: async (channel, handler, onLost) => (await getDb()).listen(channel, handler, onLost),
  });
}
async function type(text: string) {
  const opened = await sessions.open(owner, pageId, regionId);
  if (opened.status !== 200) throw new Error(`open ${opened.status}`);
  const doc = openRegionDoc(Buffer.from(opened.body.state, 'base64'), { gc: true, clientId: opened.body.clientId });
  const before = Y.encodeStateVector(doc);
  regionText(doc).insert(0, text, {});
  const sent = await sessions.update(owner, pageId, regionId, { clientId: opened.body.clientId, update: Y.encodeStateAsUpdate(doc, before) });
  expect(sent.status).toBe(200);
}
async function watch() {
  const abort = new AbortController();
  aborts.push(abort);
  const opened = await sessions.stream(owner, pageId, `${regionId}:0`, abort.signal);
  expect(opened.status).toBe('open');
  if (opened.status === 'open') void opened.stream.pipeTo(new WritableStream()).catch(() => {});
  return abort;
}
const version = async () => (await getArtifactById(pageId))!.version;
const waitTimers = () => new Promise((resolve) => setTimeout(resolve, 30));

beforeEach(async () => {
  intervals = [];
  const user = await createUser({ email: 'mxmx_test_region_saves@example.com' });
  owner = identityForUser(user.id, null);
  const row = await createArtifact(null, user.id, { format: 'html', source: nativeHtml('<article data-af-editable="rich"><p>Hello</p></article>'), meta: {}, visibility: 'private' });
  pageId = row.id;
  regionId = editableRegions(row.source!)[0]!.id;
});
afterEach(async () => {
  for (const abort of aborts.splice(0)) abort.abort();
  await waitTimers();
  await sessions?.settle();
  sessions?.dispose();
});

it('saves when the last editor stream of the page closes, not while another is open', async () => {
  sessions = instance(0);
  const first = await watch(), second = await watch();
  await type('left behind ');
  first.abort();
  await waitTimers(); await sessions.settle();
  expect(await version()).toBe(1);
  second.abort();
  await waitTimers(); await sessions.settle();
  expect(await version()).toBe(2);
  expect((await getArtifactById(pageId))!.source).toContain('left behind Hello');
});

it('a reconnect within the grace is not a leave', async () => {
  sessions = instance(200);
  const first = await watch();
  await type('still here ');
  first.abort();
  await new Promise((resolve) => setTimeout(resolve, 20));
  await watch();
  await new Promise((resolve) => setTimeout(resolve, 260));
  await sessions.settle();
  expect(await version()).toBe(1);
});

it('the idle backstop saves a region dirty and quiet for REGION_IDLE_SAVE_MS, and not one still being typed in', async () => {
  sessions = instance(60_000);
  await watch();
  await type('first ');
  now += REGION_IDLE_SAVE_MS - 1_000;
  fireIdleChecks(); await sessions.settle();
  expect(await version()).toBe(1);
  await type('second ');
  // The backstop's own condition, under the page lock: a save asked for as idle finds this region typed in just now.
  const due = { quietBefore: new Date(now - REGION_IDLE_SAVE_MS).toISOString(), dirtyBefore: new Date(now - REGION_MAX_UNSAVED_MS).toISOString() };
  expect(await sessions.flush(owner, pageId, { due })).toEqual({ status: 200, body: { version: 1 } });
  now += REGION_IDLE_SAVE_MS / 2;
  fireIdleChecks(); await sessions.settle();
  expect(await version()).toBe(1);
  now += REGION_IDLE_SAVE_MS;
  fireIdleChecks(); await sessions.settle();
  expect(await version()).toBe(2);
  expect((await getArtifactById(pageId))!.source).toContain('second first Hello');
  const [row] = (await (await getDb()).query<{ dirty_since: string | null }>('SELECT dirty_since FROM region_states WHERE artifact_id = $1', [pageId])).rows;
  expect(row!.dirty_since).toBeNull();
  now += REGION_IDLE_SAVE_MS * 2;
  fireIdleChecks(); await sessions.settle();
  expect(await version()).toBe(2);
});

it('typing that never pauses is saved once it has been unsaved for REGION_MAX_UNSAVED_MS', async () => {
  sessions = instance(60_000);
  await watch();
  const step = REGION_IDLE_SAVE_MS / 2;
  let typed = 0;
  for (; typed * step < REGION_MAX_UNSAVED_MS - step; typed++) {
    await type(`w${typed} `);
    now += step;
    fireIdleChecks(); await sessions.settle();
  }
  expect(await version()).toBe(1);
  await type('last ');
  now += step;
  fireIdleChecks(); await sessions.settle();
  expect(await version()).toBe(2);
  expect((await getArtifactById(pageId))!.source).toContain('last w');
});
