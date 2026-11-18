/**
 * THE TWO-PROCESS REGION SCENARIO (region-processes.test.ts on PGLite, region-processes-postgres.test.ts on a real
 * PostgreSQL): two RegionSessions instances, each over its own database handle, type at once, follow each other's
 * streams and save racing; every update is accepted once, in one order, both streams deliver all of them, and the
 * saves make one version.
 */
import { expect } from 'vitest';
import * as Y from 'yjs';
import type { AccessActor } from '@/lib/accounts';
import { openRegionDoc, regionHtml, regionText } from '@/lib/live-regions';
import { createRegionSessions, type RegionSessions } from '@/lib/region-sessions';
import type { Db } from '@/lib/platform';
import { sseStream } from './sse';

export const BODY = '<article data-af-editable="rich"><p>Hello world</p></article>';

/** One "process": its own instance over its own database handle. */
function processOn(db: () => Promise<Db>): RegionSessions {
  return createRegionSessions({ db, keepaliveFrame: () => 'event: keepalive\ndata: {}\n\n', subscribe: async (channel, handler, onLost) => (await db()).listen(channel, handler, onLost), leaveGraceMs: 60_000 });
}

export interface Scenario { pageId: string; regionId: string; alice: AccessActor; bob: AccessActor; dbs: [() => Promise<Db>, () => Promise<Db>]; headVersion(): Promise<number> }

async function editor(sessions: RegionSessions, actor: AccessActor, scenario: Scenario) {
  const opened = await sessions.open(actor, scenario.pageId, scenario.regionId);
  if (opened.status !== 200) throw new Error(`open ${opened.status} ${JSON.stringify(opened.body)}`);
  const doc = openRegionDoc(Buffer.from(opened.body.state, 'base64'), { clientId: opened.body.clientId });
  return { doc, seq: opened.body.seq, clientId: opened.body.clientId };
}

export async function concurrentTyping(scenario: Scenario) {
  const [one, two] = [processOn(scenario.dbs[0]), processOn(scenario.dbs[1])];
  const aborts: AbortController[] = [];
  try {
    const a = await editor(one, scenario.alice, scenario), b = await editor(two, scenario.bob, scenario);
    const watch = async (sessions: RegionSessions, actor: AccessActor) => {
      const abort = new AbortController();
      aborts.push(abort);
      const opened = await sessions.stream(actor, scenario.pageId, `${scenario.regionId}:${b.seq}`, abort.signal);
      if (opened.status !== 'open') throw new Error(opened.status);
      return sseStream(opened.stream);
    };
    const [streamOne, streamTwo] = [await watch(one, scenario.alice), await watch(two, scenario.bob)];
    const ROUNDS = 15;
    const typist = async (sessions: RegionSessions, actor: AccessActor, side: typeof a, letter: string) => {
      const seqs: number[] = [];
      for (let i = 0; i < ROUNDS; i++) {
        const before = Y.encodeStateVector(side.doc);
        regionText(side.doc).insert(0, `${letter}${i} `, {});
        const answer = await sessions.update(actor, scenario.pageId, scenario.regionId, { clientId: side.clientId, update: Y.encodeStateAsUpdate(side.doc, before) });
        if (answer.status !== 200) throw new Error(`update ${answer.status} ${JSON.stringify(answer.body)}`);
        seqs.push(answer.body.seq);
      }
      return seqs;
    };
    const [seqsA, seqsB] = await Promise.all([typist(one, scenario.alice, a, 'A'), typist(two, scenario.bob, b, 'B')]);
    const all = [...seqsA, ...seqsB].sort((x, y) => x - y);
    expect(all).toEqual(Array.from({ length: 2 * ROUNDS }, (_unused, i) => b.seq + 1 + i));

    const replay = async (frames: ReturnType<typeof sseStream>) => {
      const replica = openRegionDoc(undefined, { gc: true });
      let to = b.seq;
      // The frames decide; the bound only ends a replay that never completes before the test's own timeout.
      const deadline = Date.now() + 30_000;
      while (to < b.seq + 2 * ROUNDS && Date.now() < deadline) {
        for (const event of await frames.next(1, deadline - Date.now())) {
          const frame = event.data as { type?: string; from?: number; to?: number; updates?: string[] };
          if (frame.type !== 'updates') continue;
          expect(frame.from).toBe(to + 1);
          for (const update of frame.updates!) Y.applyUpdate(replica, Buffer.from(update, 'base64'));
          to = frame.to!;
        }
      }
      expect(to).toBe(b.seq + 2 * ROUNDS);
      return replica;
    };
    const base = openRegionDoc(Y.encodeStateAsUpdate(a.doc), { gc: true });
    const [seenOne, seenTwo] = await Promise.all([replay(streamOne), replay(streamTwo)]);
    for (const seen of [seenOne, seenTwo]) {
      Y.applyUpdate(seen, Y.encodeStateAsUpdate(base));
      for (let i = 0; i < ROUNDS; i++) for (const letter of ['A', 'B']) expect(regionText(seen).toString()).toContain(`${letter}${i} `);
    }
    expect(regionHtml('rich', Y.encodeStateAsUpdate(seenOne))).toBe(regionHtml('rich', Y.encodeStateAsUpdate(seenTwo)));

    // Saves racing from both processes make exactly one version, holding everyone's text.
    const before = await scenario.headVersion();
    const flushed = await Promise.all([one.flush(scenario.alice, scenario.pageId), two.flush(scenario.bob, scenario.pageId)]);
    expect(flushed.map((answer) => answer.status)).toEqual([200, 200]);
    expect(await scenario.headVersion()).toBe(before + 1);
    expect(new Set(flushed.map((answer) => answer.status === 200 && answer.body.version))).toEqual(new Set([before + 1]));

    // A process whose cached document predates the other's save still validates against the saved state.
    const after = Y.encodeStateVector(b.doc);
    for (const frame of await streamTwo.next(5, 300)) if ((frame.data as { type?: string }).type === 'updates') for (const update of (frame.data as { updates: string[] }).updates) Y.applyUpdate(b.doc, Buffer.from(update, 'base64'), 'server');
    regionText(b.doc).insert(0, 'after save ', {});
    const late = await two.update(scenario.bob, scenario.pageId, scenario.regionId, { clientId: b.clientId, update: Y.encodeStateAsUpdate(b.doc, after) });
    expect(late.status).toBe(200);
  } finally {
    for (const abort of aborts) abort.abort();
    one.dispose(); two.dispose();
  }
}

