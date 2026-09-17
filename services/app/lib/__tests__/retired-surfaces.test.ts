/**
 * RETIRED VOCABULARY, SCOPED PER SURFACE — the one guard over the teaching corpus.
 *
 * `agent-starter-consistency.test.ts` owns the nine agent-facing STARTERS, where the full retired
 * vocabulary is banned outright. This file owns everything else an agent reads: the rendered skill
 * tree, the brief, the tool-schema guidance, the one-pager and the CLI's shipped teaching bundle.
 * Those bans used to be one `not.toContain` line at a time, scattered across eight files, each
 * silently covering one surface and one word.
 *
 * WHY THE LIST IS PER SURFACE AND NOT ONE FLAT BAN. Adding `token` to the list every surface
 * shares was tried and produced 17 offences in one run: `references/design.md`, every
 * `themes-*.md` and `markup.md` teach CSS DESIGN TOKENS, which is the right word for the right
 * thing, and `SKILL.md` carries the one sanctioned prohibition (`never mint or print tokens`,
 * owned by agent-starter-consistency). A ban wide enough to be uniform is a ban that has to be
 * switched off, and a switched-off ban protects nothing. So each row names the words that are
 * wrong FOR THAT SURFACE, and the row's own comment says why.
 */
import { describe, expect, it } from 'vitest';
import { agentContract } from '@/lib/agent-contract';
import { llmsText } from '@/lib/agent-discovery';
import { MARKUP_FIELD_GUIDANCE } from '@/lib/agent-guidance';
import { buildQuickSheet, renderTree, skillTree } from '@/lib/skills';
import { JSX_TIER_COMPONENTS } from '@/lib/story/jsx-tier';
import { HELMET_TAG } from '@/lib/story/helmet';
import { MUTATION_TAG, QUERY_TAG, VALUE_TAG } from '@/lib/story/dataflow';
import teaching from '../../../cli/src/generated/teaching.json';

const BASE = 'https://example.test';

/**
 * The addresses and words that are wrong on EVERY teaching surface: two of them are doors that no
 * longer exist, and the rest are addresses an agent would follow to a 404.
 *
 *   `/raw`            — an internal address. `/a/<id>` is the one public face; teaching two
 *                       addresses for one document is how the second ends up in a chat message.
 *   `MCP`             — the protocol is gone; the afbin CLI is the only client.
 *   `/docs/`          — a remote fetch (and so `/docs/data`, a second data page that briefly
 *                       existed). Every reference ships INSIDE the CLI's bundle.
 *   `tokens/anonymous`, `tokens/new` — retired mint doors. No client mints.
 */
const RETIRED_EVERYWHERE = ['/raw', 'MCP', '/docs/', 'tokens/anonymous', 'tokens/new'];

interface Surface {
  name: string;
  text: string;
  /** Beyond `RETIRED_EVERYWHERE` — the words that are wrong on THIS surface only. */
  also?: string[];
}

const surfaces = (): Surface[] => [
  ...renderTree(skillTree(), BASE).map(({ file, text }) => ({ name: `skills/${file.path}`, text })),
  {
    name: 'the installed brief (buildQuickSheet)',
    text: buildQuickSheet(BASE),
    // The retired AUTHORING forms too: an agent that copies one of these gets a 400 it cannot
    // diagnose, because the doc told it to write exactly that.
    also: ['<Param', 'data="ref:', 'ref_<id>', '"markdown"', '"html"'],
  },
  {
    name: 'lib/agent-contract',
    text: agentContract(BASE),
    // `plugin` and the old dotfile spelling are the two wrong answers to "where does auth live?".
    also: ['No local SDK or CLI', 'plugin', '~/.artifactbin.env'],
  },
  {
    name: 'the markup tool-schema guidance',
    text: MARKUP_FIELD_GUIDANCE,
  },
  {
    name: 'the /llms.txt one-pager',
    text: llmsText(BASE),
    // `afbin setup` was a step; sign-in is automatic now, so naming it sends an agent to a prompt
    // that no longer exists.
    also: ['afbin setup'],
  },
  {
    name: "the CLI bundle's auth guide",
    text: teaching.files['references/publishing-auth.md']!,
  },
  {
    name: "the CLI bundle's publishing guide",
    text: teaching.files['references/publishing.md']!,
    // It ROUTES authentication to the auth guide rather than answering it, so it never teaches
    // self-minting; and the file workflow is the CLI's, never a raw HTTP call.
    also: ['afbin api', 'PATCH /api/'],
  },
];

describe('no teaching surface names a retired one', () => {
  it('every surface is clean of the words that are wrong on it', () => {
    const offences: string[] = [];
    for (const { name, text, also } of surfaces()) {
      for (const word of [...RETIRED_EVERYWHERE, ...(also ?? [])]) {
        if (text.includes(word)) offences.push(`${name}: "${word}"`);
      }
    }
    expect(offences).toEqual([]);
  });

  it('is judging the whole corpus, not an empty one (the scan cannot silently find nothing)', () => {
    const all = surfaces();
    expect(all.length).toBeGreaterThan(10);
    expect(all.some(({ name }) => name === 'skills/artifactbin/SKILL.md')).toBe(true);
    for (const { name, text } of all) expect(text.length, name).toBeGreaterThan(0);
  });

  it('still teaches the one public address and the binding that replaces the raw URL', () => {
    const corpus = renderTree(skillTree(), BASE).map(({ text }) => text).join('\n');
    expect(corpus).toContain('Share its returned URL');
    expect(corpus).toContain('ref:');
  });
});

/**
 * Every component we NAME to an agent must exist. A component named in the docs that the registry
 * does not have is not a stale comment — it is a documented instruction that returns 400
 * `invalid_jsx` the first time an agent follows it, and the agent has no way to know the doc was
 * wrong rather than its own markup. `<Markdown>` was exactly that.
 *
 * The vocabulary comes from the PUBLISH DOOR, not from a copy of it, so the promise and the
 * validation cannot drift apart.
 */
describe('the components we promise to agents', () => {
  const KNOWN = new Set<string>([...JSX_TIER_COMPONENTS, HELMET_TAG, VALUE_TAG, QUERY_TAG, MUTATION_TAG]);
  const AGENT_FACING = ['artifactbin/references/markup.md', 'artifactbin/references/markup-data.md', 'artifactbin/SKILL.md'];
  const rendered = (path: string) => renderTree(skillTree(), BASE).find(({ file }) => file.path === path)!.text;
  /** Capitalized JSX-shaped tags named in that prose: `<Name>`, `<Name …`, `</Name>`. */
  const componentsNamed = (text: string) => [...new Set([...text.matchAll(/<\/?([A-Z][A-Za-z0-9]*)[\s/>]/g)].map((m) => m[1]!))];

  it.each(AGENT_FACING)('%s names only components that exist', (path) => {
    const named = componentsNamed(rendered(path));
    expect(named.filter((name) => !KNOWN.has(name)), `${path} documents component(s) the registry does not have`).toEqual([]);
  });

  it('is actually looking at something (the scan cannot silently find nothing)', () => {
    expect(AGENT_FACING.flatMap((path) => componentsNamed(rendered(path)))).toContain(HELMET_TAG);
  });
});
