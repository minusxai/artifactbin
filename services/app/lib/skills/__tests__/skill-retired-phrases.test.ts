/**
 * RETIRED AND CONTRADICTORY PHRASING STAYS OUT OF THE SKILL. The author-skill rulings of 2026-11-04 (an audit of every
 * skill text and script string plus production eval traces) found small models acting on whichever of two
 * disagreeing sentences they read first. Each concept now has one rule in one place: SKILL.md routes, script --help
 * and output own flags and next steps (the Reply block is the only reply text), starter headers own their usage,
 * references teach technique. This guard fails when a retired wording returns anywhere an agent reads it: SKILL.md,
 * references, examples, component headers, script sources, the API's monitoring guidance and the operations registry.
 * Each row names its ruling, so a hit says why the phrase went. It reads files by path, so it runs in the guard lane.
 */
import {readdirSync, readFileSync} from 'node:fs';
import {describe, expect, it} from 'vitest';

const SKILL = new URL('../../../skills/artifactbin/', import.meta.url);
const LIB = new URL('../../', import.meta.url);
type Scope = 'skill' | 'references' | 'examples' | 'components' | 'scripts' | 'monitoring' | 'registry';
const read = (url: URL) => readFileSync(url, 'utf8');
const dir = (name: string, pattern: RegExp) => readdirSync(new URL(name, SKILL)).filter(file => pattern.test(file)).sort()
  .map(file => ({path: `skills/artifactbin/${name}${file}`, text: read(new URL(name + file, SKILL))}));
/** Each scope's files, as an agent reads them: a component source is read for its header comment only. */
const FILES: Record<Scope, Array<{path: string; text: string}>> = {
  skill: [{path: 'skills/artifactbin/SKILL.md', text: read(new URL('SKILL.md', SKILL))}],
  references: dir('references/', /\.md$/),
  examples: dir('examples/', /\.(?:html|mjs|ts|csv)$/),
  components: dir('components/', /\.ts$/).map(file => ({...file, text: file.text.slice(0, file.text.indexOf('*/') + 2)})),
  scripts: dir('scripts/', /\.mjs$/),
  monitoring: [{path: 'lib/artifact-wire/monitoring-guidance.ts', text: read(new URL('artifact-wire/monitoring-guidance.ts', LIB))}],
  registry: [{path: 'lib/operations/registry.ts', text: read(new URL('operations/registry.ts', LIB))}],
};
const DOCS: Scope[] = ['skill', 'references', 'examples', 'components'];
const AGENT_TEXT: Scope[] = [...DOCS, 'scripts'];

interface Retired {
  /** What must not return (case as written unless the pattern says otherwise). */
  pattern: RegExp;
  /** Where an agent would read it. */
  scopes: Scope[];
  /** The ruling that retired it, and what replaces it. */
  reason: string;
  /** The one sanctioned wording that contains the pattern, removed before matching. */
  allow?: string;
}

const RETIRED: Retired[] = [
  {pattern: /run_in_background/, scopes: [...AGENT_TEXT, 'monitoring'],
    reason: 'H1: one blocking watch mode for every harness; no Claude Code background branch'},
  {pattern: /never end your turn while the watch/i, scopes: [...AGENT_TEXT, 'monitoring'],
    reason: 'H1: the watch is a foreground command that returns; its output says when to stop'},
  {pattern: /write_stdin|exec_command/, scopes: [...AGENT_TEXT, 'monitoring'],
    reason: 'H1: no per-harness (Codex) watch instructions'},
  {pattern: /another watch is already running/, scopes: [...AGENT_TEXT, 'monitoring'],
    reason: 'H1: a second watch --next on the page takes over the running one instead of refusing'},
  {pattern: /(?<![.\w])timeout\(1\)/, scopes: [...AGENT_TEXT, 'monitoring'], allow: 'never wrap the command in timeout(1)',
    reason: 'H2: the one timeout sentence lives in comment.mjs; agent shells often lack timeout(1)'},
  {pattern: /(?:^|[\s`'"(])timeout\s+\d+[smh]?\s+\S/m, scopes: [...AGENT_TEXT, 'monitoring'],
    reason: 'Principle 6: never suggest wrapping a command in timeout(1)'},
  {pattern: /shell tool(?:'s)? (?:a )?timeout|timeout to 300000/i, scopes: DOCS,
    reason: 'H2: the shell-tool timeout is stated once, by comment.mjs --help and its printed next line'},
  {pattern: /<<-?\s*(['"]?)[A-Z_]{2,}\1(?=\s|$)|\bcat\s*>[^\n]*<</, scopes: [...AGENT_TEXT, 'monitoring'],
    reason: 'Principle 6: sandboxes block heredocs; write a file or pass an inline flag (comment.mjs --body TEXT)'},
  {pattern: /\bVerified:|\bNot verified\b|\bas Verified\b/, scopes: [...AGENT_TEXT, 'monitoring'],
    reason: 'H11: check reports only Tested: and Not tested:'},
  {pattern: /\/af\/core\.js/, scopes: DOCS,
    reason: 'H9: the platform loads the core runtime; no page or example writes the core script'},
  {pattern: /\bcore script\b/i, scopes: ['references'],
    reason: 'H9: runtime.md says the platform loads the core runtime'},
  {pattern: /edit_artifact/, scopes: [...AGENT_TEXT, 'registry'],
    reason: 'H13: the registry operation is update_artifact'},
  {pattern: /(?:^|[\s`'"])--param\b/m, scopes: [...AGENT_TEXT, 'registry'],
    reason: 'H13: the retired --param flag'},
  {pattern: /onBackendChange/, scopes: [...AGENT_TEXT, 'monitoring'],
    reason: 'L1: onResolverChange is the only change listener'},
  {pattern: /Publish it unchanged/i, scopes: AGENT_TEXT,
    reason: 'H4: step 3 is "publish after step 2"; publish refuses leftover starter placeholders itself'},
  {pattern: /never publish (?:the|a) (?:ref: )?placeholder/i, scopes: DOCS,
    reason: 'H4: publish refuses ref: placeholders and [bracketed] starter text with the fix'},
  {pattern: /\bas printed\b/i, scopes: ['references', 'examples', 'components'],
    reason: 'H10: the one reply rule is in SKILL.md; check prints the Reply block'},
  {pattern: /Describe (?:how it's built|testing)|copy check's Slide images|reply also says how others get access/i,
    scopes: ['skill'], reason: 'H10: Built with, Tested, Slide images and Who can do what are lines of the Reply block'},
  {pattern: /read only one\b/i, scopes: DOCS, reason: 'M8: read only the references your task needs'},
  {pattern: /per-slide PNG export/i, scopes: AGENT_TEXT, reason: 'M6: the deck Built with line names what the page does'},
  {pattern: /af-slide-deck/, scopes: ['skill'], reason: 'H12: decks use examples/deck.html; the skill names one deck path'},
  {pattern: /data-af-id="/, scopes: ['references', 'components', 'examples'],
    allow: '[data-af-id="', reason: 'H8: static elements need no hand-written data-af-id (runtime.md#dynamic-elements-and-comments)'},
  {pattern: /`data-af-id` only to keep|Keep every existing `data-af-id`/, scopes: DOCS,
    reason: 'H8: publish keeps, drops or renumbers ids itself; one rule in runtime.md'},
  {pattern: /\bset (?:SLIDE_COUNT|CHART_COUNT|REAL|CATEGORY)\b|\bkeep CATEGORY\b|to match SLIDES/, scopes: DOCS,
    reason: 'M4: steps files are copied unchanged and read their counts from the page'},
  {pattern: /never retune|adjust (?:its|PAYERS)/i, scopes: DOCS, reason: 'M17: gen-transactions changes only names'},
  {pattern: /For an unpublished local project/, scopes: ['references'], reason: 'M14: serve.mjs is routed once, from SKILL.md'},
  {pattern: /Load the chosen design-system CSS/, scopes: ['references'], reason: 'M16: the platform loads the design-system CSS'},
  {pattern: /Show the user the read-back/i, scopes: [...DOCS, 'scripts'],
    reason: 'H10: the dataset permission read-back is the Reply block\'s Who can do what line'},
];

/** Every line of the scope's files where the retired pattern occurs. */
function hits({pattern, scopes, allow}: Retired): string[] {
  const global = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g');
  return scopes.flatMap(scope => FILES[scope].flatMap(({path, text}) => {
    const body = allow ? text.replaceAll(allow, ' '.repeat(allow.length)) : text;
    return [...body.matchAll(global)].map(match => `${path}:${body.slice(0, match.index).split('\n').length}: ${match[0].trim()}`);
  }));
}

describe('retired skill phrasing', () => {
  it.each(RETIRED.map(row => [row.reason, row] as const))('%s', (_reason, row) => {
    expect(hits(row)).toEqual([]);
  });
  it('fires on each phrase it guards, so a row cannot silently match nothing', () => {
    const samples: Record<string, string> = {
      'H1: one blocking': "start it with the Bash tool's `run_in_background`", 'H2: the one timeout': 'wrap it in timeout(1)',
      'Principle 6: never': 'timeout 300 node scripts/comment.mjs watch ID', 'Principle 6: sandboxes': "cat > reply.txt <<'EOF'",
      'H11:': 'Verified: 390x844', 'H9: the platform loads the core runtime;': '<script src="/af/core.js"></script>',
      'H8: static': '<h1 data-af-id="title">', 'M4:': 'set SLIDE_COUNT to match',
    };
    for (const [prefix, text] of Object.entries(samples)) {
      const row = RETIRED.find(candidate => candidate.reason.startsWith(prefix))!;
      expect(row, prefix).toBeDefined();
      expect(new RegExp(row.pattern.source, row.pattern.flags).test(text), prefix).toBe(true);
    }
    // The sanctioned wordings pass: comment.mjs's own timeout sentence and steps selectors that read script-made ids.
    expect('give your shell tool a timeout of at least 300000 ms; never wrap the command in timeout(1)'
      .replaceAll('never wrap the command in timeout(1)', '')).not.toMatch(/timeout\(1\)/);
    expect('AbortSignal.timeout(10000)').not.toMatch(RETIRED.find(row => row.allow?.startsWith('never'))!.pattern);
  });
  it('states the reply rule once: SKILL.md says "as printed" in its one reply line', () => {
    const skill = FILES.skill[0]!.text.replace(/\s+/g, ' ');
    expect(skill.match(/as printed/g)).toHaveLength(1);
    expect(skill).toContain('Your reply is what the user asked for: if they prescribed its form (e.g. only the URL), send exactly ' +
      'that; otherwise send the link and then the Reply block check printed, as printed.');
  });
});
