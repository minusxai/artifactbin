/**
 * EVERY DATA EXAMPLE THE SKILL TEACHES IS PUBLISHED, so the docs cannot drift from the product.
 *
 * A ```jsx block holding a `<Helmet>` is a complete document: it goes through the real create door,
 * compiled and bound-checked exactly as an agent's copy would be, with each placeholder dataset id
 * (`ref:abc123`) replaced by a dataset this test publishes first. A placeholder the registry does not
 * know fails, so a new example cannot slip past by naming a dataset nobody made. Blocks without a
 * `<Helmet>` are fragments of a document shown elsewhere and are not published.
 *
 * The booking document is the skill's large worked example: its block in markup-data-example must BE the
 * golden fixture the compiler and server tests run, and every excerpt the walkthrough explains must be
 * a piece of it.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { DatasetColumn } from '@artifactbin/contracts';
import { POST as create } from '@/app/api/artifacts/route';
import { parseDatasetDefinition } from '@/lib/datasets/definition';
import { renderTree, skillTree } from '@/lib/skills';
import { mintToken } from '@/lib/tokens';
import { claimToken, createUser } from '@/lib/users';
import { examples as starters } from '../../cli/src/teaching';
import { request, useAppHarness } from './harness';

useAppHarness();

type Row = Record<string, string | number | boolean | null>;
/** A placeholder dataset: its shape and a few rows. `null` names a placeholder no test here can publish, and says why. */
type Placeholder = { columns: DatasetColumn[]; rows: Row[] } | { unpublishable: string };

const PLACEHOLDERS: Record<string, Placeholder> = {
  /** Sales: the dashboard, deck, editorial and filter examples. */
  abc123: {
    columns: [{ name: 'day', type: 'date' }, { name: 'month', type: 'string' }, { name: 'region', type: 'string' }, { name: 'revenue', type: 'number' }],
    rows: [
      { day: '2026-07-06', month: '2026-07', region: 'EU', revenue: 1200 },
      { day: '2026-08-03', month: '2026-08', region: 'NA', revenue: 1900 },
    ],
  },
  /** Sprints, read by the roadmap editors. */
  def456: { columns: [{ name: 'name', type: 'string' }], rows: [{ name: 'S1' }] },
  /** The editable roadmap. */
  rdm123: {
    columns: [
      { name: 'id', type: 'number' }, { name: 'item', type: 'string' }, { name: 'owner', type: 'string' }, { name: 'hours', type: 'number' },
      { name: 'depends_on', type: 'string' }, { name: 'tags', type: 'string' }, { name: 'status', type: 'string' }, { name: 'sprint', type: 'string' },
    ],
    rows: [{ id: 1, item: 'Plan', owner: 'TBD', hours: null, depends_on: '[]', tags: '[]', status: 'backlog', sprint: '' }],
  },
  /** Tasks with user fields. */
  tsk123: {
    columns: [
      { name: 'id', type: 'number' }, { name: 'task', type: 'string' },
      { name: 'assigned_to', type: 'user' }, { name: 'completed_by', type: 'user', constraints: { self: true } },
    ],
    rows: [{ id: 1, task: 'Review proposal', assigned_to: null, completed_by: null }],
  },
  /** A photo gallery's rows. */
  bks123: {
    columns: [{ name: 'id', type: 'string' }, { name: 'title', type: 'string' }, { name: 'cover_ref', type: 'string' }, { name: 'has_photo', type: 'boolean' }, { name: 'position', type: 'number' }],
    rows: [{ id: 'b1', title: 'Dune', cover_ref: '', has_photo: false, position: 1 }],
  },
  /** Daily traffic, the scrolly template's costume. */
  trf123: { columns: [{ name: 'day', type: 'date' }, { name: 'transits', type: 'number' }], rows: [{ day: '2026-09-01', transits: 41 }] },
  /** The booking golden's dataset (booking-dataflow.test.ts). */
  BookRows1: {
    columns: [
      { name: 'id', type: 'string' }, { name: 'day', type: 'date' }, { name: 'slot', type: 'string' },
      { name: 'booked_by', type: 'user' }, { name: 'note', type: 'string' }, { name: 'created_at', type: 'timestamp' },
    ],
    rows: [],
  },
  /** Connected Postgres: publishing needs a live database; its compile path is covered by the postgres dataflow tests. */
  pgs123: { unpublishable: 'a connected Postgres database' },
};

const BASE = 'https://artifactbin.example';
const GOLDEN = readFileSync(new URL('../lib/story/__tests__/fixtures/booking.jsx', import.meta.url), 'utf8');
const docs = renderTree(skillTree(), BASE).filter(({ file }) => file.path.startsWith('artifactbin/'));
const jsxBlocks = (text: string) => [...text.matchAll(/```jsx\n([\s\S]*?)```/g)].map((m) => m[1]!);
/** A document's YAML fence is the CLI's to send as metadata; the create door takes the body. */
const body = (block: string) => block.replace(/^---\n[\s\S]*?\n---\n/, '');
/**
 * A template's skeleton: the indented document under its "Skeleton (…):" label. It elides its chart
 * specs (`spec":{…}`) by design, so its DATA half is what is published: the Helmet, over an empty body.
 */
const skeletons = (text: string) => [...text.matchAll(/^skeleton[^\n]*\n\n((?:(?: {2}[^\n]*)?\n)+)/gim)]
  .map((m) => /<Helmet>[\s\S]*?<\/Helmet>/.exec(m[1]!.replace(/^ {2}/gm, ''))?.[0])
  .filter((helmet): helmet is string => !!helmet).map((helmet) => `${helmet}\n<main />\n`);
const examples = [
  ...docs.flatMap(({ file, text }) => [...jsxBlocks(text), ...skeletons(text)].filter((b) => b.includes('<Helmet>')).map((block, n) => ({ at: `${file.path} #${n + 1}`, block: body(block) }))),
  // `afbin help <template>`'s starters, which the CLI prints as a file to adapt.
  ...Object.entries(starters).filter(([, block]) => block.includes('<Helmet>')).map(([name, block]) => ({ at: `afbin starter ${name}`, block })),
];

async function owner() {
  const email = 'mxmx_test_skill_examples@example.com';
  const token = await mintToken(email);
  const user = await createUser({ email });
  await claimToken(user.id, token.token);
  return token.token;
}

async function publish(token: string, json: Record<string, unknown>) {
  const res = await create(request('/api/artifacts', { method: 'POST', token, json }));
  return { status: res.status, text: await res.text() };
}

describe('the skill\'s data examples', () => {
  it('finds the examples it publishes', () => {
    expect(examples.length).toBeGreaterThan(10);
  });

  it.each(examples.map((e) => [e.at, e.block] as const))('publishes %s', async (_at, block) => {
    const refs = [...new Set([...block.matchAll(/ref:([A-Za-z0-9]{6,12})\b/g)].map((m) => m[1]!))];
    for (const ref of refs) expect(Object.keys(PLACEHOLDERS), `ref:${ref} is not a placeholder this test publishes — add it to PLACEHOLDERS`).toContain(ref);
    const skip = refs.map((ref) => PLACEHOLDERS[ref]!).find((p) => 'unpublishable' in p);
    if (skip) return;
    const token = await owner();
    let markup = block;
    for (const ref of refs) {
      const p = PLACEHOLDERS[ref] as { columns: DatasetColumn[]; rows: Row[] };
      const made = await publish(token, { dataset: p.rows, columns: p.columns, access: 'readwrite' });
      expect(made.status, made.text).toBe(201);
      markup = markup.replaceAll(`ref:${ref}`, `ref:${JSON.parse(made.text).id}`);
    }
    const doc = await publish(token, { markup, visibility: 'unlisted' });
    expect(doc.status, doc.text).toBe(201);
  });
});

/** The stored `<Dataset>` definitions a reference tells an agent to save and push (a Postgres one needs a live database and its secret). */
const definitions = docs.flatMap(({ file, text }) => jsxBlocks(text).filter((b) => b.startsWith('<Dataset kind="stored"')).map((block, n) => [`${file.path} #${n + 1}`, block] as const));

describe('the skill\'s dataset definitions', () => {
  it('finds them', () => expect(definitions.length).toBeGreaterThanOrEqual(2));
  it.each(definitions)('creates %s through the publish door', async (_at, block) => {
    const made = await publish(await owner(), { dataset: parseDatasetDefinition(block) });
    expect(made.status, made.text).toBe(201);
  });
});

describe('the booking walkthrough', () => {
  const data = docs.find(({ file }) => file.path === 'artifactbin/references/markup-data-example.md')!.text;
  const walkthrough = /\n## Worked example: a booking page\n([\s\S]*?)(?=\n## |$)/.exec(data)?.[1] ?? '';

  it('carries the golden booking document, byte for byte', () => {
    expect(jsxBlocks(walkthrough)).toContain(GOLDEN);
  });

  it('explains only excerpts of that document', () => {
    const excerpts = [...walkthrough.matchAll(/```(?:jsx|sql)\n([\s\S]*?)```/g)].map((m) => m[1]!).filter((b) => b !== GOLDEN);
    expect(excerpts.length).toBeGreaterThan(3);
    for (const excerpt of excerpts) for (const line of excerpt.split('\n').filter((l) => l.trim())) expect(GOLDEN, 'an excerpt line the document does not hold').toContain(line);
  });
});
