/**
 * Every component we NAME to an agent must exist.
 *
 * `GET /docs/*` and the MCP tool descriptions are the protocol: an agent
 * reads them and writes exactly what they show. A component named there that
 * the registry does not have is not a stale comment — it is a documented
 * instruction that returns 400 `invalid_jsx` the first time an agent follows
 * it, and the agent has no way to know the doc was wrong rather than its own
 * markup. `<Markdown>` was exactly that: removed from the kit (prose is
 * ordinary HTML tags now, no authoring language), left standing in the MCP
 * description of `create_artifact`.
 *
 * Same reasoning as no-dead-format and no-dead-api-link — the retirement of
 * anything touches more copy than anyone remembers, so the rule gets a test.
 *
 * Only STRING content is scanned: these files are TypeScript, and `<Response>`
 * inside `Promise<Response>` is a type, not a promise made to an agent.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { JSX_TIER_COMPONENTS } from '@/lib/story/jsx-tier';
import { HELMET_TAG } from '@/lib/story/helmet';
import { MUTATION_TAG, QUERY_TAG, VALUE_TAG } from '@/lib/story/dataflow';

const ROOT = path.resolve(__dirname, '../..');

/** The surfaces an agent actually reads to learn what it may write. */
const AGENT_FACING = ['skills/artifactbin/references/markup.md', 'skills/artifactbin/references/markup-data.md', 'skills/artifactbin/SKILL.md', 'app/mcp/route.ts'];

/**
 * The vocabulary is taken from the PUBLISH DOOR (`JSX_TIER_COMPONENTS`), not
 * from a copy of it, so the promise and the validation cannot drift apart.
 * `<Helmet>` and its data declarations `<Value>`/`<Query>`/`<Mutation>` are real
 * vocabulary but sit outside that registry: they are the document-level door,
 * handled by lib/story/helmet.ts + lib/story/dataflow.ts before the kit ever
 * sees the tree (see their module docs).
 */
const KNOWN = new Set<string>([...JSX_TIER_COMPONENTS, HELMET_TAG, VALUE_TAG, QUERY_TAG, MUTATION_TAG]);

/** String literals only — template, single- and double-quoted. */
function stringContent(source: string): string {
  const literals = source.match(/`(?:[^`\\]|\\[\s\S])*`|'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"/g);
  return (literals ?? []).join('\n');
}

/** Capitalized JSX-shaped tags named in that prose: `<Name>`, `<Name …`, `</Name>`. */
function componentsNamed(text: string): string[] {
  return [...new Set([...text.matchAll(/<\/?([A-Z][A-Za-z0-9]*)[\s/>]/g)].map((m) => m[1]))];
}

describe('the components we promise to agents', () => {
  it.each(AGENT_FACING)('%s names only components that exist', (rel) => {
    const named = componentsNamed(stringContent(readFileSync(path.join(ROOT, rel), 'utf8')));
    const dead = named.filter((n) => !KNOWN.has(n));
    expect(dead, `${rel} documents component(s) the registry does not have`).toEqual([]);
  });

  it('is actually looking at something (the scan cannot silently find nothing)', () => {
    const named = AGENT_FACING.flatMap((rel) =>
      componentsNamed(stringContent(readFileSync(path.join(ROOT, rel), 'utf8'))),
    );
    expect(named).toContain(HELMET_TAG);
  });
});
