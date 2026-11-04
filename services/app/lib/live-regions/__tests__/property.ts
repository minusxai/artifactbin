/**
 * Random interleavings for the property tests: 2–5 real editors and a server, and operations drawn by fast-check
 * (type text, typed Markdown shortcuts, delete a range, split, join, toggle a mark, set a link, undo, redo, republish,
 * an agent's Markdown edit, compaction) mixed with delivery (partial sends, receives in reverse, shuffled or
 * duplicated order, partitions that heal). After the run everyone reconnects and the room's invariants hold.
 *
 * I4 is STRICT and tracked by character: every character typed is unique (a CJK ideograph), so each is present at
 * the end unless someone deleted it: a range someone deleted while seeing it, a block an author or agent rewrote, or
 * its own typist's undo. Nothing else may remove a character: not a join, a split, a block deletion around it, a
 * type change or a code-block conversion. (Concurrent overlapping formatting is the one pinned limitation, and it
 * removes no text.)
 */
import fc from 'fast-check';
import { DOMParser as PMDOMParser } from 'prosemirror-model';
import { defaultMarkdownSerializer, schema as markdownSchema } from 'prosemirror-markdown';
import { expect } from 'vitest';
import { Room, type Client } from './harness';

type Op =
  | { op: 'type'; client: number; at: number; length: number }
  | { op: 'shortcut'; client: number; at: number; which: (typeof SHORTCUTS)[number] }
  | { op: 'bold'; client: number; at: number; length: number }
  | { op: 'delete'; client: number; at: number; length: number }
  | { op: 'split' | 'join'; client: number; at: number }
  | { op: 'mark'; client: number; at: number; length: number; mark: 'b' | 'i' | 'e' }
  | { op: 'link'; client: number; at: number; length: number }
  | { op: 'undo' | 'redo' | 'send' | 'toggle'; client: number }
  | { op: 'receive'; client: number; order: 'forward' | 'reverse' | 'shuffled' | 'duplicated'; seed: number }
  | { op: 'sync' | 'compact' }
  | { op: 'republish'; at: number; change: 'text' | 'heading' | 'delete' | 'add' }
  | { op: 'agent'; at: number };
const SHORTCUTS = ['# ', '## ', '- ', '* ', '1. ', '> ', '```', '---'] as const;

const REGIONS = [
  '<h2>Plan</h2><p>First paragraph.</p><ul><li>one</li><li>two<ul><li>deep</li></ul></li></ul><blockquote><p>quoted</p></blockquote><pre><code>code</code></pre><hr><p>last</p>',
  '<p>alpha</p><p>beta</p>',
  '',
];

const scenario = (maxOps: number) => fc.integer({ min: 2, max: 5 }).chain((clients) => {
  const client = fc.nat({ max: clients - 1 });
  const at = fc.nat({ max: 10_000 });
  const type = fc.record({ op: fc.constant('type' as const), client, at, length: fc.integer({ min: 1, max: 4 }) });
  const op: fc.Arbitrary<Op> = fc.oneof(
    { weight: 8, arbitrary: type },
    { weight: 3, arbitrary: fc.record({ op: fc.constant('shortcut' as const), client, at, which: fc.constantFrom(...SHORTCUTS) }) },
    { weight: 1, arbitrary: fc.record({ op: fc.constant('bold' as const), client, at, length: fc.integer({ min: 1, max: 6 }) }) },
    { weight: 3, arbitrary: fc.record({ op: fc.constant('delete' as const), client, at, length: fc.integer({ min: 1, max: 12 }) }) },
    { weight: 3, arbitrary: fc.record({ op: fc.constantFrom('split' as const, 'join' as const), client, at }) },
    { weight: 2, arbitrary: fc.record({ op: fc.constant('mark' as const), client, at, length: fc.integer({ min: 1, max: 8 }), mark: fc.constantFrom('b' as const, 'i' as const, 'e' as const) }) },
    { weight: 1, arbitrary: fc.record({ op: fc.constant('link' as const), client, at, length: fc.integer({ min: 1, max: 8 }) }) },
    { weight: 2, arbitrary: fc.record({ op: fc.constantFrom('undo' as const, 'redo' as const), client }) },
    { weight: 4, arbitrary: fc.record({ op: fc.constantFrom('send' as const, 'toggle' as const), client }) },
    { weight: 4, arbitrary: fc.record({ op: fc.constant('receive' as const), client, order: fc.constantFrom('forward' as const, 'reverse' as const, 'shuffled' as const, 'duplicated' as const), seed: fc.nat() }) },
    { weight: 2, arbitrary: fc.constantFrom({ op: 'sync' as const }, { op: 'compact' as const }) },
    { weight: 1, arbitrary: fc.record({ op: fc.constant('republish' as const), at, change: fc.constantFrom('text' as const, 'heading' as const, 'delete' as const, 'add' as const) }) },
    { weight: 1, arbitrary: fc.record({ op: fc.constant('agent' as const), at }) },
  );
  // Every run starts by typing (the region always has a text block then), so each one has tracked text for I4.
  const ops = fc.tuple(type, fc.array(op, { maxLength: maxOps - 1 })).map(([first, rest]): Op[] => [first, ...rest]);
  return fc.record({ clients: fc.constant(clients), region: fc.constantFrom(...REGIONS.keys()), ops });
});
export type Scenario = { clients: number; region: number; ops: Op[] };

/** Cursor positions inside text blocks, in document order. */
const positions = (client: Client) => {
  const out: number[] = [];
  client.state.doc.forEach((block, offset) => { if (block.isTextblock) for (let p = 0; p <= block.content.size; p++) out.push(offset + 1 + p); });
  return out;
};
const pick = <T>(list: readonly T[], at: number) => list[at % list.length]!;
const TRACKED = /[一-鿿]/gu;
const tracked = (text: string) => text.match(TRACKED) ?? [];

/** One run (a shrunk counterexample replays through it); returns the number of characters lost to the known limitation. */
export function runScenario({ clients: count, region, ops }: Scenario): { lost: number; typed: number } {
  const room = new Room('rich', REGIONS[region]!);
  const clients = Array.from({ length: count }, (_unused, index) => room.join(String.fromCharCode(65 + index)));
  let next = 0x4e00;
  const unique = (length: number) => Array.from({ length }, () => String.fromCodePoint(next++)).join('');
  const owner = new Map<string, Client>();
  const deliberate = new Set<string>();
  const undid = new Set<Client>();
  const press = (client: Client, key: string) => client.view.someProp('handleKeyDown', (handler) => handler(client.view, new KeyboardEvent('keydown', { key, bubbles: true })));
  const savedBlocks = () => {
    const template = document.createElement('template');
    template.innerHTML = /<article[^>]*>([\s\S]*)<\/article>/.exec(room.page.html)![1]!;
    return { template, blocks: [...template.content.querySelectorAll('p, h1, h2, h3, h4, h5, h6, pre')] as HTMLElement[] };
  };
  const revised = (before: string, after: string) => { const kept = new Set(tracked(after)); for (const character of tracked(before)) if (!kept.has(character)) deliberate.add(character); };
  try {
    for (const step of ops) {
      const client = 'client' in step ? clients[step.client % count]! : clients[0]!;
      // A region can hold no text block at all (a lone rule after a join): edits need a cursor in one.
      const editing = ['type', 'shortcut', 'bold', 'delete', 'split', 'join', 'mark', 'link'].includes(step.op);
      if (editing && !positions(client).length) continue;
      switch (step.op) {
        case 'type': {
          const text = unique(step.length);
          for (const character of text) owner.set(character, client);
          client.select(pick(positions(client), step.at)).type(text);
          break;
        }
        case 'shortcut': {
          const blocks: number[] = [];
          client.state.doc.forEach((block, offset) => { if (block.isTextblock) blocks.push(offset + 1); });
          client.select(pick(blocks, step.at)).type(step.which);
          break;
        }
        case 'bold': {
          const all = positions(client);
          const from = pick(all, step.at);
          const $from = client.state.doc.resolve(from);
          // The closing delimiters go the same distance before the block's end: the opening ones can complete a
          // shortcut themselves (`*x` + `*` is italic), which shortens the block, so a fixed `end + 2` can fall past it.
          const tail = $from.end() - Math.min(from + step.length, $from.end());
          const $open = client.select(from).type('**').state.selection.$head;
          client.select(Math.max($open.pos, $open.end() - tail)).type('**');
          break;
        }
        case 'delete': {
          const all = positions(client);
          const index = step.at % all.length;
          const from = all[index]!, to = all[Math.min(all.length - 1, index + step.length)]!;
          for (const character of tracked(client.state.doc.textBetween(from, to))) deliberate.add(character);
          client.delete(from, to);
          break;
        }
        case 'split': client.select(pick(positions(client), step.at)); press(client, 'Enter'); break;
        case 'join': {
          const starts: number[] = [];
          client.state.doc.forEach((block, offset) => { if (block.isTextblock && offset > 0) starts.push(offset + 1); });
          if (starts.length) { client.select(pick(starts, step.at)); press(client, 'Backspace'); }
          break;
        }
        case 'mark': {
          const all = positions(client);
          const index = step.at % all.length;
          client.select(all[index]!, all[Math.min(all.length - 1, index + step.length)]!);
          client.view.someProp('handleKeyDown', (handler) => handler(client.view, new KeyboardEvent('keydown', { key: step.mark, ctrlKey: true, bubbles: true })));
          break;
        }
        case 'link': {
          const all = positions(client);
          const index = step.at % all.length;
          client.select(all[index]!, all[Math.min(all.length - 1, index + step.length)]!);
          client.commands.link(`https://x.dev/${step.at}`)(client.state, client.view.dispatch);
          break;
        }
        case 'undo': undid.add(client); client.undo(); break;
        case 'redo': undid.add(client); client.redo(); break;
        case 'send': room.send(client); break;
        case 'toggle': client.online = !client.online; break;
        case 'receive': {
          const missing = room.log.map((_update, index) => index).filter((index) => !client.received.has(index));
          const random = mulberry(step.seed);
          const order = step.order === 'reverse' ? missing.reverse()
            : step.order === 'shuffled' ? missing.sort(() => random() - 0.5)
              : step.order === 'duplicated' ? [...missing, ...missing, ...[...client.received].slice(0, 3)] : missing;
          room.receive(client, order);
          break;
        }
        case 'sync': room.sync(); break;
        case 'compact': room.compact(); break;
        case 'republish': {
          const { template, blocks } = savedBlocks();
          const before = template.innerHTML;
          const block = blocks.length ? pick(blocks, step.at) : null;
          if (step.change === 'add' || !block) template.content.append(Object.assign(document.createElement('p'), { textContent: unique(3) }));
          else if (step.change === 'text') block.textContent = unique(4);
          else if (step.change === 'delete') block.remove();
          else if (block.localName !== 'pre') {
            const renamed = document.createElement(block.localName === 'h2' ? 'p' : 'h2');
            for (const attribute of [...block.attributes]) renamed.setAttribute(attribute.name, attribute.value);
            renamed.append(...block.childNodes);
            block.replaceWith(renamed);
          }
          revised(before, template.innerHTML);
          room.republish(() => template.innerHTML);
          break;
        }
        case 'agent': {
          const { template, blocks } = savedBlocks();
          const before = template.innerHTML;
          if (blocks.length) pick(blocks, step.at).textContent = unique(4);
          revised(before, template.innerHTML);
          const markdown = defaultMarkdownSerializer.serialize(PMDOMParser.fromSchema(markdownSchema).parse(template.content));
          room.agent(markdown);
          break;
        }
      }
    }
    for (const client of clients) client.online = true;
    const html = room.invariants();
    const present = new Set(tracked(html));
    const lost = [...owner].filter(([character, typist]) => !present.has(character) && !deliberate.has(character) && !undid.has(typist));
    expect(lost.map(([character, typist]) => `${character} typed by ${typist.name}`), 'I4: characters nobody deleted are gone').toEqual([]);
    return { lost: lost.length, typed: owner.size };
  } finally {
    room.destroy();
  }
}

function mulberry(seed: number) {
  let state = seed >>> 0;
  return () => { state = (state + 0x6d2b79f5) >>> 0; let t = state; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/**
 * Runs `runs` random interleavings of up to `maxOps` operations. fast-check prints the seed, path and shrunk
 * counterexample of a failure: `replay` (the seed and path, at the failing run's `maxOps`) re-runs exactly that case,
 * and the shrunk counterexample becomes a fixed `runScenario` case in convergence.property.test.ts, so pr fast keeps it.
 */
export function checkConvergence(runs: number, maxOps: number, replay?: { seed: number; path: string }): { typed: number; lost: number } {
  const totals = { typed: 0, lost: 0, silent: 0 };
  fc.assert(fc.property(scenario(maxOps), (run) => {
    const result = runScenario(run);
    totals.typed += result.typed;
    totals.lost += result.lost;
    if (!result.typed) totals.silent++;
  }), replay ? { ...replay, endOnFailure: true } : { numRuns: runs });
  // Each run's first operation types: a run that typed nothing exercised no I4 and means the generator broke.
  expect(totals.silent, 'runs that typed nothing').toBe(0);
  return { typed: totals.typed, lost: totals.lost };
}
