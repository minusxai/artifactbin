/**
 * RETIRED AND CONTRADICTORY PHRASING STAYS OUT OF EVERYTHING AN AGENT READS. The author-skill rulings of 2026-11-04 (an
 * audit of every skill text and script string plus production eval traces) found small models acting on whichever of
 * two disagreeing sentences they read first. Each concept now has one rule in one place: SKILL.md routes, script
 * --help and output own flags and next steps (check prints the facts for the reply), starter headers own their
 * usage, references teach technique. ONE table, one reason per row (its ruling): a hit says why the phrase went. The
 * scopes are SKILL.md, references, examples, component and design-system CSS headers, script sources, the API's monitoring guidance, the
 * operations registry, the page runtime, and every product source's strings outside the deprecated GraphQL layer (the hints
 * and replies the product hands an agent: a dataset's usage, a refusal's hint). The single exception is lib/html-runtime/legacy-page-names.ts, the
 * isolated alias live pages still call. It reads files by path, so it runs in the `pr fast` guard tier
 * (scripts/ci/guard-tests.json).
 */
import {readdirSync, readFileSync} from 'node:fs';
import ts from 'typescript';
import {describe, expect, it} from 'vitest';
import {WATCH_LOOP} from '@/lib/artifact-wire';

const SKILL = new URL('../../../skills/artifactbin/', import.meta.url);
const LIB = new URL('../../', import.meta.url);
type Scope = 'skill' | 'references' | 'examples' | 'components' | 'scripts' | 'monitoring' | 'registry' | 'runtime' |
  'designSystems' | 'product' | 'productStrings';
const read = (url: URL) => readFileSync(url, 'utf8');
const dir = (name: string, pattern: RegExp) => readdirSync(new URL(name, SKILL)).filter(file => pattern.test(file)).sort()
  .map(file => ({path: `skills/artifactbin/${name}${file}`, text: read(new URL(name + file, SKILL))}));
/** The one file allowed to name the old runtime listener: live pages published before 2026-11-04 call it. */
const COMPAT = 'legacy-page-names.ts';
const runtime = readdirSync(new URL('html-runtime/', LIB)).filter(file => file.endsWith('.ts')).sort();
const APP = new URL('../../../', import.meta.url);
/** The deprecated GraphQL layer (scripts/ci/module-graph.mjs GRAPHQL_COMPAT.paths): what it answers older pages stays. */
const GRAPHQL_LAYER = ['lib/graphql-compat/', 'lib/html-runtime/apollo/graphql-compat'];
/** The product's own sources (the skill tree has its scopes above), tests and the GraphQL layer left out. */
const product = ['app', 'lib', 'server', 'solid'].flatMap(top => readdirSync(new URL(top + '/', APP), {recursive: true,
  encoding: 'utf8'}).map(file => `${top}/${file}`)).filter(file => /\.tsx?$/.test(file) &&
  !/(?:^|\/)(?:__tests__|node_modules)\//.test(file) && !GRAPHQL_LAYER.some(prefix => file.startsWith(prefix))).sort()
  .map(file => ({path: file, text: read(new URL(file, APP))}));
/** A source with all but its string, template and JSX text blanked, newlines kept: what it says, never its comments. */
function literals({path, text}: {path: string; text: string}): {path: string; text: string} {
  if (!text.includes('gql')) return {path, text: ''};
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, false,
    path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const kept = text.replace(/[^\n]/g, ' ').split('');
  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateLiteralToken(node) ||
      ts.isJsxText(node)) for (let i = node.getStart(source); i < node.end; i++) kept[i] = text[i]!;
    node.forEachChild(visit);
  };
  visit(source);
  return {path, text: kept.join('')};
}
/** Each scope's files, as an agent reads them: a component source is read for its header comment only. */
const FILES: Record<Scope, Array<{path: string; text: string}>> = {
  skill: [{path: 'skills/artifactbin/SKILL.md', text: read(new URL('SKILL.md', SKILL))}],
  references: dir('references/', /\.md$/),
  examples: dir('examples/', /\.(?:html|mjs|ts|csv)$/),
  components: dir('components/', /\.ts$/).map(file => ({...file, text: file.text.slice(0, file.text.indexOf('*/') + 2)})),
  scripts: dir('scripts/', /\.mjs$/),
  monitoring: [{path: 'lib/artifact-wire/monitoring-guidance.ts', text: read(new URL('artifact-wire/monitoring-guidance.ts', LIB))}],
  registry: [{path: 'lib/operations/registry.ts', text: read(new URL('operations/registry.ts', LIB))}],
  designSystems: dir('design-systems/', /\.css$/).map(file => ({...file, text: file.text.slice(0, file.text.indexOf('*/') + 2)})),
  runtime: runtime.filter(file => file !== COMPAT)
    .map(file => ({path: `lib/html-runtime/${file}`, text: read(new URL('html-runtime/' + file, LIB))})),
  product,
  productStrings: product.map(literals),
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
    allow: "with the Bash tool's run_in_background first",
    reason: 'H1: the watch mode is stated once, by harness (WATCH_MODE): no other background wording'},
  {pattern: /never end your turn while the watch/i, scopes: [...AGENT_TEXT, 'monitoring'],
    reason: 'H1: the watch is a foreground command that returns; its output says when to stop'},
  {pattern: /write_stdin|exec_command/, scopes: [...AGENT_TEXT, 'monitoring'],
    reason: 'H1: no per-harness (Codex) watch instructions'},
  {pattern: /another watch is already running/, scopes: [...AGENT_TEXT, 'monitoring'],
    reason: 'H1: a second watch --next on the page takes over the running one instead of refusing'},
  {pattern: /(?<![.\w])timeout\(1\)/, scopes: [...AGENT_TEXT, 'monitoring'],
    reason: 'H2: the one timeout sentence is WATCH_MODE (a shell timeout); no text mentions timeout(1)'},
  {pattern: /(?:^|[\s`'"(])timeout\s+\d+[smh]?\s+\S/m, scopes: [...AGENT_TEXT, 'monitoring'],
    reason: 'Principle 6: never suggest wrapping a command in timeout(1)'},
  {pattern: /shell (?:tool(?:'s)? )?(?:a )?timeout|timeout to 300000/i, scopes: [...DOCS, 'monitoring'],
    reason: 'H2: the shell timeout is stated once, by WATCH_MODE (comment.mjs --help and the printed Next line)'},
  {pattern: /<<-?\s*(['"]?)[A-Z][A-Z_]*\1(?=\s|$)|\bcat\s*>[^\n]*<</, scopes: [...AGENT_TEXT, 'monitoring'],
    reason: 'Principle 6: sandboxes block heredocs; write a file or pass an inline flag (comment.mjs --body TEXT)'},
  {pattern: /\bVerified:|\bNot verified\b|\bas Verified\b/, scopes: [...AGENT_TEXT, 'monitoring'],
    reason: 'H11: check reports only Tested: and Not tested:'},
  {pattern: /\/af\/core\.js/, scopes: DOCS,
    reason: 'H9: the platform loads the core runtime; no page or example writes the core script'},
  {pattern: /\bcore script\b/i, scopes: ['references'],
    reason: 'H9: runtime.md says the platform loads the core runtime'},
  {pattern: /\bedit_artifact\b/, scopes: [...AGENT_TEXT, 'registry'],
    reason: 'H13: the registry operation is update_artifact'},
  {pattern: /(?:^|[\s`'"])--param\b/m, scopes: [...AGENT_TEXT, 'registry'],
    reason: 'H13: the retired --param flag'},
  {pattern: /\bonBackendChange\b/, scopes: [...AGENT_TEXT, 'monitoring', 'runtime'],
    reason: 'L1: onResolverChange is the only change listener (live pages keep the alias in legacy-page-names.ts)'},
  {pattern: /Publish it unchanged/i, scopes: AGENT_TEXT,
    reason: 'H4: step 3 is "publish after step 2"; publish refuses leftover starter placeholders itself'},
  {pattern: /never publish (?:the|a) (?:ref: )?placeholder/i, scopes: DOCS,
    reason: 'H4: publish refuses ref: placeholders and [bracketed] starter text with the fix'},
  {pattern: /\bas printed\b/i, scopes: [...AGENT_TEXT, 'monitoring'],
    reason: 'S1: the reply is the link plus what was asked; check prints facts, not a block to copy'},
  {pattern: /Describe how it's built|copy check's Slide images|reply also says how others get access/i,
    scopes: ['skill'], reason: 'H10: Built with, Tested, Slide images and Who can do what are check\'s facts for the reply'},
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
    reason: 'H10: the dataset permission read-back is the Who can do what line of check\'s facts'},
  // The 2026-11-05 simplification (S): production-first text, one rule per concept, no eval-prompt echoes.
  {pattern: /Reply block|send every line before the blank line|copy these lines exactly|anything not listed in Tested/,
    scopes: [...AGENT_TEXT, 'monitoring'], reason: 'S1: check prints "For your reply:" facts, never a block to copy'},
  {pattern: /\b(?:never|do not|don't) reword\b|word for word|no testing or build claims/i, scopes: AGENT_TEXT,
    reason: 'S2: no policing of the agent\'s own words; Read first says to describe testing only from check'},
  {pattern: /draft copy|in reasoning\b/i, scopes: AGENT_TEXT, reason: 'S2: no policing of the agent\'s thinking'},
  {pattern: /change nothing else|only the URL|the URL alone|end to end|summary of how/i, scopes: [...AGENT_TEXT, 'monitoring'],
    reason: 'S2: no quoted eval-prompt phrases; a prescribed reply form is one general Read first sentence'},
  {pattern: /in the same response|AND send|leaves comments unanswered/, scopes: [...AGENT_TEXT, 'monitoring'],
    reason: 'S3: the order of reply and watch is stated once, in WATCH_MODE'},
  {pattern: /do not end your turn/i, scopes: [...AGENT_TEXT, 'monitoring'],
    reason: 'S3: it contradicts the Claude Code watch mode (reply as the last message and end the turn)'},
  {pattern: /wrap a script in|write files with heredocs/i, scopes: AGENT_TEXT, reason: 'S4: no harness hacks in the skill'},
  {pattern: /(?:don't|do not) open (?:the )?qa JSON|fetch the slide images/i, scopes: [...AGENT_TEXT, 'monitoring'],
    reason: 'S4: check stops printing what it does not want read (a clean pass names no result file)'},
  {pattern: /You\/Partner|may stay as it is|add no --visibility/, scopes: AGENT_TEXT,
    reason: 'S5: starters keep Usage and real Gotchas; visibility is stated once, in SKILL.md Sharing'},
  // The 2026-11-05 production focus (P): no eval-shaped checks, cost steering or legacy notes in what agents read.
  {pattern: /states only what its slide shows|ask shares (?:add up|sum)|starts from the traction chart|title claims '/,
    scopes: [...AGENT_TEXT], reason: 'P1: deck steps check what the template does; it computes shares and the milestone'},
  {pattern: /not wc -l|use this count/, scopes: AGENT_TEXT, reason: 'P1: the generator prints its count; no coaching'},
  {pattern: /separate from the reply|link-only|e\.g\. only the link|watch still runs/, scopes: [...AGENT_TEXT, 'monitoring'],
    reason: 'P2: the reply is one plain Read first sentence; the watch order is WATCH_MODE'},
  {pattern: /owner steps that expect a refusal/, scopes: AGENT_TEXT,
    reason: 'P2: permissions.md states only that owners and editors always have full access'},
  {pattern: /Republish only|never for polish|no-steps smoke|export every slide|every slide to test/i, scopes: AGENT_TEXT,
    reason: 'P3: no cost steering; check and export help say what they do (the owner-approved exception is SKILL.md Known failure modes, each note under 50 words)'},
  {pattern: /Original Chart defaults|old compact default|Previously downloaded|Mermaid\.js `initialize`|KEPT FOR EXISTING/,
    scopes: AGENT_TEXT, reason: 'P4: no legacy or migration notes in agent text (no backward-compat prose)'},
  {pattern: /no connected databases|no raw TCP|out of reach/, scopes: AGENT_TEXT,
    reason: 'P5: backend functions reach Postgres and MySQL with caps.db (references/functions.md)'},
  {pattern: /head -30 scripts|read the top of it|New page, steps|served; skip|don't read the CSS|This file is for reading/,
    scopes: [...AGENT_TEXT, 'designSystems'], reason: 'P6: scripts are learned with --help; design-system CSS needs no reading'},
  {pattern: /Household budget|qa-1\.json|older starter title|\^(?:Pitch deck|Shared dashboard)\$/, scopes: AGENT_TEXT,
    reason: 'P1: starters carry neutral placeholders and no one-prompt constants'},
  {pattern: /\((?:rulings? )?[HMSL]\d{1,2}(?:, [HMSL]\d{1,2})*\)/, scopes: AGENT_TEXT,
    reason: 'P6: internal ruling tags stay out of agent-readable text'},
  // The 2026-11-10 SQL model (Q): new pages read and write datasets with sql, call their own API with
  // fetch('/fn/NAME') and keep viewer state in @afbin/state. GraphQL is deprecated: the skill carries nothing for it.
  {pattern: /client\s*\.\s*(?:query|mutate|watchQuery|updateQuery|addResolvers)\b/, scopes: AGENT_TEXT,
    reason: 'Q1: datasets are read and written with sql, viewer state with @afbin/state, never the Apollo client'},
  {pattern: /\bgql\s*[`(\[]|`gql`/, scopes: AGENT_TEXT,
    reason: 'Q1: gql is never named: GraphQL is deprecated and the skill carries nothing for older pages'},
  {pattern: /downloaded copy has no app connection: `sql` rejects|show that the data lives in the original page/, scopes: AGENT_TEXT,
    reason: 'Q4: a downloaded copy answers its sql reads from the rows it carries (lib/html-runtime offline-sql)'},
  {pattern: /\btypeDefs\b/, scopes: AGENT_TEXT,
    reason: 'Q2: a backend file exports functions, roles, secrets and schedule; never GraphQL SDL'},
  {pattern: /@auth\b/, scopes: AGENT_TEXT, reason: 'Q2: export const roles = {name: role} says who may call a function'},
  {pattern: /(?<![\w.$])_sql\b/, scopes: [...AGENT_TEXT, 'registry'],
    reason: 'Q1: a page computes with the sql tag (sql`…`), not the _sql GraphQL field'},
  {pattern: /\bGraphQL\b|\bApollo (?:state|client|value)/i, scopes: DOCS,
    reason: 'Q1: no GraphQL teaching: it is deprecated, and the skill has no command or note for it'},
  {pattern: /graphql\.mjs|toolbox-graphql|preview-datasets|preview-sessions|__af_preview\/datasets|localPreview/, scopes: AGENT_TEXT,
    reason: 'Q1: the skill ships no GraphQL command and no local GraphQL dataset preview; sql.mjs reads and writes datasets'},
  // The 2026-11-11 reply order (W): agents holding every link announced the watch instead of replying, and the watch
  // never returned.
  {pattern: /part of every task/i, scopes: [...AGENT_TEXT, 'monitoring'],
    reason: 'W1: watching follows the reply (WATCH_MODE); "part of every task" let the reply wait for the watch'},
  // The 2026-11-11 visibility facts (V): an agent left the product over link sharing when private was allowed only on the word "private".
  {pattern: /team can view"? needs\s+nothing more|Everyone with the link reads the notes/,
    scopes: AGENT_TEXT, reason: 'V1: who reads a page at each visibility is stated once, in SKILL.md Sharing'},
  {pattern: /confidential or\s+internal|calls? the data\s+confidential|Published private:/, scopes: AGENT_TEXT,
    reason: 'V2: a page is private on the user\'s own word, never the agent\'s view of the data (one called a sales pipeline internal and published it where the team it was for could not open it)'},
  {pattern: /reaches (?:a|another) file only through a link|fetch its href/, scopes: [...AGENT_TEXT, 'runtime'],
    reason: 'A script fetches a file published with its page by the path it wrote (fetch(\'./data.json\'), html-runtime fn-fetch); no link-and-href recipe'},
  // The 2026-11-11 product hints (Q5): a dataset's create reply handed agents a gql page and the removed graphql.mjs.
  {pattern: /graphql\.mjs/, scopes: ['product'],
    reason: 'Q5: no product text names graphql.mjs, which the skill no longer ships: sql.mjs reads and writes datasets'},
  {pattern: /\bgql\s*\\?[`(\[]|`gql`|\{[^}]*\bgql\b[^}]*\}\s*from\s*['"]@afbin\/apollo/, scopes: ['productStrings'],
    reason: 'Q5: no product hint teaches gql: new pages read and write with sql (only the GraphQL layer answers older pages)'},
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
      'H1: the watch mode': 'start the watch with run_in_background', 'H2: the one timeout': 'wrap it in timeout(1)',
      'Principle 6: never': 'timeout 300 node scripts/comment.mjs watch ID', 'Principle 6: sandboxes': "cat > reply.txt <<'EOF'",
      'H11:': 'Verified: 390x844', 'H9: the platform loads the core runtime;': '<script src="/af/core.js"></script>',
      'H8: static': '<h1 data-af-id="title">', 'M4:': 'set SLIDE_COUNT to match', 'H13: the registry': 'call edit_artifact',
      'H13: the retired': 'pass --param x=1', 'L1:': 'onBackendChange(fn)', 'H4: step 3': 'Publish it unchanged.',
      'H1: a second': 'another watch is already running', 'S1: check prints': 'send the Reply block',
      'S3: the order': 'reply and watch in the same response', 'S3: it contradicts': 'Do not end your turn',
      'S4: check stops': "don't open the qa JSON", 'S5: starters': 'payers: names, never You/Partner.',
      'P1: deck steps': 'every title states only what its slide shows', 'P1: the generator': 'use this count, not wc -l',
      'P2: the reply': '(separate from the reply, even a link-only one)', 'P2: permissions.md': 'write no owner steps that expect a refusal',
      'P3:': 'Republish only to fix a failed requirement', 'P4:': 'Original Chart defaults: transparent',
      'P5:': 'there are no connected databases', 'P6: scripts': 'read `head -30 scripts/NAME.mjs`',
      'P1: starters': "title: '[Household budget]'", 'P6: internal': 'belongs to another page (H7).',
      'Q1: datasets': 'await client.query({query})', 'Q1: gql is': 'const q=gql`{index}`;', 'Q2: a backend': 'export const typeDefs = `',
      'Q2: export': 'test: String! @auth(role: owner)', 'Q1: a page computes': '{ _sql(sql: $s) { rows } }', 'Q1: no GraphQL': 'reads rows with GraphQL',
      'Q1: the skill ships': 'node scripts/graphql.mjs schema ID',
      'W1:': 'Watching is part of every task, however short the reply.',
      'V1:': 'so "my team can view" needs\n  nothing more.',
      'V2:': 'calls the data confidential or\n  internal',
      'Q5: no product text': 'Exact fields: node scripts/graphql.mjs schema ID',
      'Q5: no product hint': "import {client,gql} from '@afbin/apollo';",
    };
    for (const [prefix, text] of Object.entries(samples)) {
      const row = RETIRED.find(candidate => candidate.reason.startsWith(prefix))!;
      expect(row, prefix).toBeDefined();
      expect(new RegExp(row.pattern.source, row.pattern.flags).test(text), prefix).toBe(true);
    }
    // Code that calls a timeout function is not the retired wording.
    expect('AbortSignal.timeout(10000)').not.toMatch(RETIRED.find(row => row.reason.startsWith('H2: the one timeout'))!.pattern);
    expect('const x=1<<n;\n').not.toMatch(RETIRED.find(row => row.reason.startsWith('Principle 6: sandboxes'))!.pattern);
    // A product hint is read from its strings: the same words in a comment are not handed to anyone.
    const gqlHint = RETIRED.find(row => row.reason.startsWith('Q5: no product hint'))!.pattern;
    const strings = (text: string) => literals({path: 'sample.ts', text}).text;
    expect(strings('const usage = `const q=gql\\`{rows}\\`;`;')).toMatch(gqlHint);
    expect(strings('// the page\'s own gql`…` documents\nconst gql = 1;')).not.toMatch(gqlHint);
    expect(FILES.product.map(file => file.path)).toContain('lib/datasets/dataset-usage.ts');
    expect(FILES.product.some(file => GRAPHQL_LAYER.some(prefix => file.path.startsWith(prefix)))).toBe(false);
  });
  it('allows the old runtime name only in its isolated compatibility module, which says when to delete it', () => {
    expect(runtime).toContain(COMPAT);
    expect(FILES.runtime.map(file => file.path)).not.toContain(`lib/html-runtime/${COMPAT}`);
    expect(read(new URL('html-runtime/' + COMPAT, LIB)))
      .toMatch(/Delete when no live page uses it\.[\s\S]*export const onBackendChange = onResolverChange;/);
  });
  it('keeps the monitor instruction and the served watch guide on the same loop sentence (H1 drift)', () => {
    const guide = FILES.references.find(file => file.path.endsWith('/html-operations.md'))!.text;
    const section = guide.slice(guide.indexOf('## Watch for comments'));
    expect(section.slice(0, section.indexOf('\n## ', 3))).toContain(WATCH_LOOP);
    expect(FILES.monitoring[0]!.text).toContain('${WATCH_LOOP}');
  });
  it('states the reply rule once, in SKILL.md Read first', () => {
    const skill = FILES.skill[0]!.text.replace(/\s+/g, ' ');
    expect(skill).toContain('The reply never waits on a watch: every link the user asked for plus what they asked, in the ' +
      'form they asked for; a form they prescribe limits its text, never the watch. ' +
      'Describe testing, build and permissions only from what `check` reported.');
    expect(skill.match(/The reply (?:is|never)/g)).toHaveLength(1);
  });
});
