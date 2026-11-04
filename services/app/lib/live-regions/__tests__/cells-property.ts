/**
 * Random interleavings for a live DATASET TEXT CELL (../cells): 2–5 people typing into a plain input (each edit the
 * smallest splice of the input's new value, as @afbin/collab sends it), a server that validates every update as a
 * plain-text region before storing it, and the dataset around them: other writes merged three-way from the value the
 * cell last saw, and saves that move that value. Delivery is partial, reversed, shuffled, duplicated or partitioned.
 *
 * STRICT, tracked by character: every typed character is unique (a CJK ideograph), so at the end each is present
 * unless someone deleted it while seeing it, or a dataset write rewrote a value that held it. Nothing else may lose
 * one; and every replica, the server and the saved value converge.
 */
import fc from 'fast-check';
import * as Y from 'yjs';
import { expect } from 'vitest';
import { applyCellRevision, cellText, openRegionDoc, cellValue, createCellState, snapshotValue, spliceText } from '../cells';
import { validateRegionUpdate } from '../validate';

type Op =
  | { op: 'type'; client: number; at: number; length: number }
  | { op: 'delete'; client: number; at: number; length: number }
  | { op: 'send'; client: number }
  | { op: 'receive'; client: number; order: 'forward' | 'reverse' | 'shuffled' | 'duplicated'; seed: number }
  | { op: 'write'; at: number; change: 'append' | 'rewrite' | 'clear' }
  | { op: 'save' };

const scenario = (maxOps: number) => fc.integer({ min: 2, max: 5 }).chain((clients) => {
  const client = fc.nat({ max: clients - 1 });
  const at = fc.nat({ max: 10_000 });
  const op: fc.Arbitrary<Op> = fc.oneof(
    { weight: 8, arbitrary: fc.record({ op: fc.constant('type' as const), client, at, length: fc.integer({ min: 1, max: 4 }) }) },
    { weight: 3, arbitrary: fc.record({ op: fc.constant('delete' as const), client, at, length: fc.integer({ min: 1, max: 6 }) }) },
    { weight: 5, arbitrary: fc.record({ op: fc.constant('send' as const), client }) },
    { weight: 5, arbitrary: fc.record({ op: fc.constant('receive' as const), client, order: fc.constantFrom('forward' as const, 'reverse' as const, 'shuffled' as const, 'duplicated' as const), seed: fc.nat() }) },
    { weight: 1, arbitrary: fc.record({ op: fc.constant('write' as const), at, change: fc.constantFrom('append' as const, 'rewrite' as const, 'clear' as const) }) },
    { weight: 2, arbitrary: fc.constant({ op: 'save' as const }) },
  );
  return fc.record({ clients: fc.constant(clients), initial: fc.constantFrom('', 'Fix the login bug', 'line one\nline two'), ops: fc.array(op, { minLength: 1, maxLength: maxOps }) });
});
type Scenario = { clients: number; initial: string; ops: Op[] };

const TRACKED = /[一-鿿]/gu;
const tracked = (text: string) => text.match(TRACKED) ?? [];
const shuffle = <T>(items: T[], seed: number) => {
  const out = [...items];
  let state = seed || 1;
  for (let i = out.length - 1; i > 0; i--) { state = (state * 1103515245 + 12345) & 0x7fffffff; const j = state % (i + 1); [out[i], out[j]] = [out[j]!, out[i]!]; }
  return out;
};

interface Person { doc: Y.Doc; outbox: Uint8Array[]; inbox: Uint8Array[]; input: string }

function runScenario({ clients: count, initial, ops }: Scenario): { typed: number } {
  const created = createCellState(initial);
  const server = openRegionDoc(created.state);
  /** The dataset: the stored value, and the snapshot of the value the cell last saw. */
  let stored = initial, snapshot = created.snapshot;
  const people: Person[] = Array.from({ length: count }, (_unused, index) => {
    const doc = openRegionDoc(created.state, { gc: true, clientId: 1000 + index });
    const person: Person = { doc, outbox: [], inbox: [], input: initial };
    doc.on('update', (update: Uint8Array, origin: unknown) => { if (origin !== 'server') person.outbox.push(update); });
    return person;
  });
  let next = 0x4e00;
  const deliberate = new Set<string>();
  const typed = new Set<string>();
  const accept = (update: Uint8Array, clientId: number) => {
    validateRegionUpdate('text', server, update, clientId);
    for (const person of people) person.inbox.push(update);
  };
  const draw = (person: Person) => { person.input = cellValue(person.doc); };

  for (const step of ops) {
    switch (step.op) {
      case 'type': {
        const person = people[step.client % count]!;
        const at = step.at % (person.input.length + 1);
        const text = Array.from({ length: step.length }, () => String.fromCodePoint(next++)).join('');
        for (const character of text) typed.add(character);
        person.input = person.input.slice(0, at) + text + person.input.slice(at);
        spliceText(cellText(person.doc), person.input);
        break;
      }
      case 'delete': {
        const person = people[step.client % count]!;
        if (!person.input.length) break;
        const from = step.at % person.input.length, to = Math.min(person.input.length, from + step.length);
        for (const character of tracked(person.input.slice(from, to))) deliberate.add(character);
        person.input = person.input.slice(0, from) + person.input.slice(to);
        spliceText(cellText(person.doc), person.input);
        break;
      }
      case 'send': {
        const person = people[step.client % count]!;
        if (!person.outbox.length) break;
        accept(Y.mergeUpdates(person.outbox.splice(0)), person.doc.clientID);
        break;
      }
      case 'receive': {
        const person = people[step.client % count]!;
        const inbox = person.inbox.splice(0);
        const ordered = step.order === 'reverse' ? inbox.reverse() : step.order === 'shuffled' ? shuffle(inbox, step.seed) : step.order === 'duplicated' ? [...inbox, ...inbox] : inbox;
        for (const update of ordered) Y.applyUpdate(person.doc, update, 'server');
        draw(person);
        break;
      }
      case 'write': {
        // Another write to the dataset, made from the stored value; merged into the live cell from the snapshot.
        const before = stored;
        stored = step.change === 'clear' ? '' : step.change === 'append' ? `${before}!` : `${before.slice(0, step.at % (before.length + 1))}~${before.slice(step.at % (before.length + 1))}`.replace(/[a-z]+/, 'X');
        for (const character of tracked(before)) if (!stored.includes(character)) deliberate.add(character);
        const revision = applyCellRevision({ live: Y.encodeStateAsUpdate(server), savedSnapshot: snapshot, value: stored });
        expect(revision.base).toBe(before);
        Y.applyUpdate(server, revision.update);
        for (const person of people) person.inbox.push(revision.update);
        snapshot = revision.snapshot;
        expect(snapshotValue(server, snapshot)).toBe(stored);
        break;
      }
      case 'save': {
        stored = cellValue(server);
        snapshot = Y.encodeSnapshot(Y.snapshot(server));
        break;
      }
    }
  }
  // Everyone reconnects: every outbox is sent, every inbox received.
  for (const person of people) if (person.outbox.length) accept(Y.mergeUpdates(person.outbox.splice(0)), person.doc.clientID);
  for (const person of people) { for (const update of person.inbox.splice(0)) Y.applyUpdate(person.doc, update, 'server'); draw(person); }
  const final = cellValue(server);
  for (const person of people) expect(person.input).toBe(final);
  for (const character of typed) if (!deliberate.has(character)) expect(final, `lost ${character}`).toContain(character);
  return { typed: typed.size };
}

/** `runs` random scenarios of up to `maxOps` operations; throws on the first that breaks an invariant. */
export function checkCellConvergence(runs: number, maxOps: number): { typed: number } {
  let total = 0;
  fc.assert(fc.property(scenario(maxOps), (input) => { total += runScenario(input).typed; }), { numRuns: runs });
  return { typed: total };
}
