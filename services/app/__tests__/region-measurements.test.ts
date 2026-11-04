/**
 * The two numbers the live-region design asks for, measured rather than estimated. Opt-in (REGION_MEASURE=1): they
 * take seconds, and their value is the printed numbers, not a pass.
 *
 *  (a) state growth: a 2,000-word region kept with gc off, typed in between each of 500 saves (compaction and its
 *      id write-back each time); the merged state, the saved snapshot and the saved HTML, every 50 saves.
 *  (b) server time per validated update into a 10,000-word region: the whole `update` path (page FOR SHARE, row FOR
 *      UPDATE, client-id check, validation, log, NOTIFY) on the harness PGLite, and the validation alone.
 */
import { appendFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import * as Y from 'yjs';
import { createUser, identityForUser } from '@/lib/accounts';
import { createArtifact } from '@/lib/artifacts';
import { canonicalizeHtmlPage } from '@/lib/html-page';
import { compactRegion, createRegionState, editableRegions, openRegionDoc, regionText, validateRegionUpdate } from '@/lib/live-regions';
import { createRegionSessions } from '@/lib/region-sessions';
import { getDb } from '@/lib/platform';
import { nativeHtml } from './native-html-fixture';
import { useAppHarness } from './harness';

useAppHarness();
const measure = process.env.REGION_MEASURE === '1';
/** The test runner silences the console: the numbers go to REGION_MEASURE_OUT (a file), else to stderr. */
const report = (line: string) => (process.env.REGION_MEASURE_OUT ? appendFileSync(process.env.REGION_MEASURE_OUT, `${line}\n`) : process.stderr.write(`${line}\n`));

let seed = 42;
const random = () => ((seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31) / 2 ** 31);
const WORDS = ['plan', 'budget', 'quarter', 'review', 'launch', 'metric', 'growth', 'team', 'customer', 'signal'];
const paragraphs = (words: number, perParagraph = 50) => Array.from({ length: Math.ceil(words / perParagraph) }, () => `<p>${Array.from({ length: perParagraph }, () => WORDS[Math.floor(random() * WORDS.length)]).join(' ')}</p>`).join('');
const percentile = (sorted: number[], p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]!;

it.skipIf(!measure)('(a) state size over 500 saves of a 2,000-word region with typing between saves', () => {
  let page: { html: string; ledger: ReturnType<typeof canonicalizeHtmlPage>['ledger'] } = canonicalizeHtmlPage(nativeHtml(`<article data-af-editable="rich">${paragraphs(2_000)}</article>`));
  const regionId = editableRegions(page.html)[0]!.id;
  const server = openRegionDoc(createRegionState('rich', editableRegions(page.html)[0]!.inner).state);
  const editor = openRegionDoc(Y.encodeStateAsUpdate(server));
  const rows: Record<string, number>[] = [];
  const sample = (saves: number, snapshot: number) => rows.push({ saves, stateBytes: Y.encodeStateAsUpdate(server).byteLength, snapshotBytes: snapshot, htmlBytes: page.html.length, textUnits: regionText(server).length });
  sample(0, 0);
  for (let save = 1; save <= 500; save++) {
    // Between saves: a burst of typing (a sentence inserted, a few words deleted elsewhere), as keystrokes.
    const text = regionText(editor);
    const at = Math.floor(random() * (text.length - 1));
    for (const [i, ch] of [...' and then the next step'].entries()) text.insert(at + i, ch, {});
    const cut = Math.floor(random() * (text.length - 20));
    for (let k = 0; k < 6; k++) text.delete(cut, 1);
    Y.applyUpdate(server, Y.encodeStateAsUpdate(editor, Y.encodeStateVector(server)));
    const compaction = compactRegion({ savedHtml: page.html, ledger: page.ledger, regionId, state: Y.encodeStateAsUpdate(server) });
    Y.applyUpdate(server, compaction.update);
    Y.applyUpdate(editor, compaction.update);
    page = { html: compaction.html, ledger: compaction.ledger };
    if (save % 50 === 0) sample(save, compaction.snapshot.byteLength);
  }
  report(`REGION_MEASURE state growth ${JSON.stringify(rows)}`);
  expect(rows.at(-1)!.stateBytes).toBeGreaterThan(rows[0]!.stateBytes);
}, 300_000);

it.skipIf(!measure)('(b) server time per validated update into a 10,000-word region (p50/p95)', async () => {
  const user = await createUser({ email: 'mxmx_test_region_measure@example.com' });
  const actor = identityForUser(user.id, null);
  const row = await createArtifact(null, user.id, { format: 'html', source: nativeHtml(`<article data-af-editable="rich">${paragraphs(10_000)}</article>`), meta: {}, visibility: 'private' });
  const regionId = editableRegions(row.source!)[0]!.id;
  const sessions = createRegionSessions({ db: getDb, keepaliveFrame: () => '', subscribe: async (channel, handler, onLost) => (await getDb()).listen(channel, handler, onLost) });
  const opened = await sessions.open(actor, row.id, regionId);
  if (opened.status !== 200) throw new Error('open');
  const doc = openRegionDoc(Buffer.from(opened.body.state, 'base64'), { clientId: opened.body.clientId });
  const stateBytes = Buffer.from(opened.body.state, 'base64').byteLength;
  const server = openRegionDoc(Buffer.from(opened.body.state, 'base64'));
  const route: number[] = [], validation: number[] = [];
  for (let i = 0; i < 300; i++) {
    const before = Y.encodeStateVector(doc);
    const text = regionText(doc);
    if (i % 5 === 4) text.delete(Math.floor(random() * (text.length - 2)), 1);
    else text.insert(Math.floor(random() * (text.length - 1)), 'x', {});
    const update = Y.encodeStateAsUpdate(doc, before);
    let start = performance.now();
    validateRegionUpdate('rich', server, update, opened.body.clientId);
    validation.push(performance.now() - start);
    start = performance.now();
    const answer = await sessions.update(actor, row.id, regionId, { clientId: opened.body.clientId, update });
    route.push(performance.now() - start);
    expect(answer.status).toBe(200);
  }
  // Two processes taking turns: every update meets a cache the other one made stale (state + log since the last fold rebuilt).
  const other = createRegionSessions({ db: getDb, keepaliveFrame: () => '', subscribe: async (channel, handler, onLost) => (await getDb()).listen(channel, handler, onLost) });
  const alternating: number[] = [];
  for (let i = 0; i < 300; i++) {
    const before = Y.encodeStateVector(doc);
    regionText(doc).insert(Math.floor(random() * (regionText(doc).length - 1)), 'y', {});
    const start = performance.now();
    const answer = await (i % 2 ? sessions : other).update(actor, row.id, regionId, { clientId: opened.body.clientId, update: Y.encodeStateAsUpdate(doc, before) });
    alternating.push(performance.now() - start);
    expect(answer.status).toBe(200);
  }
  other.dispose();
  const summary = (times: number[]) => { const sorted = times.slice(50).sort((a, b) => a - b); return { p50: +percentile(sorted, 0.5).toFixed(2), p95: +percentile(sorted, 0.95).toFixed(2), max: +sorted.at(-1)!.toFixed(2) }; };
  report(`REGION_MEASURE update time ${JSON.stringify({ words: 10_000, stateBytes, textUnits: regionText(server).length, updates: route.length - 50, storeUpdateMs: summary(route), alternatingProcessesMs: summary(alternating), validationMs: summary(validation) })}`);
  sessions.dispose();
}, 300_000);
