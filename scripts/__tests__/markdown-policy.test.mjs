/**
 * The markdown layout and the agent instruction files (scripts/lib/markdown-policy.mjs, rules R1–R9).
 *
 * A guard has to be shown to bite: every rule first fires against a small literal tree and stays quiet on a
 * correct one; then the same validator runs once over the real repository and prints every violation with its
 * rule and file. The real file list is `git ls-files`, so untracked folders (tmp/, evals/, .agent/) are never
 * read, and R7's identifiers are found with ONE `git grep` over the tracked sources.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CLAUDE_TEXT, IDENTIFIER_PATHSPECS, SCOPED_DIRS, codeSpans, identifierPattern, identifiersIn, markdownLinks,
  referencedIdentifiers, validateMarkdownTree,
} from '../lib/markdown-policy.mjs';

const validate = (files) => validateMarkdownTree(files, identifiersIn(files, referencedIdentifiers(files)));

/** A correct tree: the root five, a dispatch table over the ten scoped pairs, two docs, a scripts map. */
function goodTree() {
  const rows = SCOPED_DIRS.map((dir) => `| [${dir}](${dir}/AGENTS.md) | editing ${dir} |`).join('\n');
  const files = {
    'README.md': '# Product\n\nSee [operations](docs/operations.md).\n',
    'CONTRIBUTING.md': 'Rules are in [AGENTS.md](AGENTS.md). Run `npm run dev`.\n',
    'SECURITY.md': 'Report privately.\n',
    'AGENTS.md': `# Working here\n\n| Working in | Read first when |\n|---|---|\n${rows}\n\n| Doc | Read when |\n|---|---|\n`
      + '| [docs/scripts.md](docs/scripts.md) | scripts |\n\nRun `npm run validate -- --reuse`; `lib/thing/index.ts` holds `makeThing()`, set `APP__PORT`.\n',
    'CLAUDE.md': CLAUDE_TEXT,
    'docs/operations.md': '# Operations\n\nSee `server.ts`, `scripts/ci/check.mjs:12` and `services/app/{lib,solid}`.\n\n```sh\nnpm run not-a-script ./no/such/path\n```\n',
    'docs/scripts.md': '# Scripts\n\n- `dev.mjs` starts it.\n- `ci/check.mjs` checks it.\n',
    'package.json': JSON.stringify({ scripts: { dev: 'node scripts/dev.mjs', validate: 'node scripts/ci/check.mjs' }, workspaces: ['services/app'] }),
    'services/app/package.json': JSON.stringify({ scripts: { 'build:reader': 'node build.mjs' } }),
    'services/app/lib/thing/index.ts': 'export const makeThing = (caps) => caps.sql(process.env.APP__PORT);\n',
    'services/app/solid/view.tsx': '',
    'services/app/skills/artifactbin/SKILL.md': 'The skill, guarded elsewhere.\n',
    'server.ts': '',
    'scripts/dev.mjs': '',
    'scripts/ci/check.mjs': '',
  };
  for (const dir of SCOPED_DIRS) {
    files[`${dir}/AGENTS.md`] = `# ${dir}\n\nOwns this directory.\n\n## Checks\n- \`npm run build:reader -w services/app\`\n`;
    files[`${dir}/CLAUDE.md`] = CLAUDE_TEXT;
  }
  return files;
}
const tree = (changes) => {
  const files = { ...goodTree(), ...changes };
  for (const [file, text] of Object.entries(changes)) if (text === undefined) delete files[file];
  return files;
};
const scopedAgents = 'services/app/lib/platform/AGENTS.md';

describe('the markdown policy, each rule seen to fire on a literal tree', () => {
  it('a correct tree has no problems', () => {
    expect(validate(goodTree())).toEqual([]);
  });

  it('R1: a markdown file outside the layout fails with its path; the skill tree and the ten pairs pass', () => {
    const problems = validate(tree({ 'services/sql/CONTRACT.md': '# x\n', 'docs/extraction/old.md': '# x\n', 'docs/unlisted.md': '# x\n' }));
    for (const file of ['services/sql/CONTRACT.md', 'docs/extraction/old.md', 'docs/unlisted.md']) {
      expect(problems).toContainEqual(expect.stringMatching(new RegExp(`^R1 ${file}: markdown is not allowed here`)));
    }
    expect(problems.filter((problem) => problem.startsWith('R1'))).toHaveLength(3);
  });

  it('R2: AGENTS.md and CLAUDE.md come in pairs and CLAUDE.md is exactly the import', () => {
    const problems = validate(tree({ 'services/app/lib/platform/CLAUDE.md': undefined, 'services/app/solid/CLAUDE.md': '@AGENTS.md', 'services/app/lib/dataflow/AGENTS.md': undefined }));
    expect(problems).toContain('R2 services/app/lib/platform/AGENTS.md: has no sibling services/app/lib/platform/CLAUDE.md');
    expect(problems).toContain('R2 services/app/solid/CLAUDE.md: must be exactly "@AGENTS.md\\n"');
    expect(problems).toContain('R2 services/app/lib/dataflow/CLAUDE.md: has no sibling AGENTS.md');
  });

  it('R3: the root stays under 8,192 bytes and a scoped file under 4,096', () => {
    const problems = validate(tree({ 'AGENTS.md': `${goodTree()['AGENTS.md']}${'x'.repeat(8192)}\n`, [scopedAgents]: `# Platform\n\n${'é'.repeat(2048)}\n` }));
    expect(problems).toContainEqual(expect.stringMatching(/^R3 AGENTS\.md: \d+ bytes; the root must stay under 8192$/));
    expect(problems).toContainEqual(expect.stringMatching(/^R3 services\/app\/lib\/platform\/AGENTS\.md: 41\d\d bytes; a scoped file must stay under 4096$/));
  });

  it('R4: the dispatch table links each scoped file once, from the table, and nothing that does not exist', () => {
    const root = goodTree()['AGENTS.md']
      .replace('| [services/app/solid](services/app/solid/AGENTS.md) | editing services/app/solid |\n', '')
      .concat('\nAlso [platform](services/app/lib/platform/AGENTS.md) and [old](services/app/lib/jsx/AGENTS.md).\n')
      .replace('| [scripts/ci](scripts/ci/AGENTS.md) | editing scripts/ci |', '| scripts/ci | editing scripts/ci |')
      .concat('\nCI: [ci](scripts/ci/AGENTS.md).\n');
    const problems = validate(tree({ 'AGENTS.md': root }));
    expect(problems).toContain('R4 AGENTS.md: the dispatch table does not link services/app/solid/AGENTS.md');
    expect(problems).toContainEqual(expect.stringMatching(/^R4 AGENTS\.md: links services\/app\/lib\/platform\/AGENTS\.md 2 times \(lines \d+, \d+\)/));
    expect(problems).toContainEqual(expect.stringMatching(/^R4 AGENTS\.md:\d+: links scripts\/ci\/AGENTS\.md outside the dispatch table$/));
    expect(problems).toContainEqual(expect.stringMatching(/^R4 AGENTS\.md:\d+: links services\/app\/lib\/jsx\/AGENTS\.md, which does not exist$/));
    expect(validate(tree({ 'AGENTS.md': undefined }))).toContain('R4 AGENTS.md: the root instruction file is missing');
  });

  it('R5: a scoped file neither links nor names another AGENTS.md, the root included', () => {
    const problems = validate(tree({ [scopedAgents]: '# Platform\n\nSee [ci](../../../../scripts/ci/AGENTS.md).\nRead the root AGENTS.md first.\n' }));
    expect(problems).toContain(`R5 ${scopedAgents}:3: a scoped file must not link or name an AGENTS.md: the root dispatches, one level deep`);
    expect(problems).toContain(`R5 ${scopedAgents}:4: a scoped file must not link or name an AGENTS.md: the root dispatches, one level deep`);
  });

  it('R6: relative links resolve to tracked files; URLs, anchors, site paths, code spans and fences are not links', () => {
    const doc = '# Ops\n\n[gone](missing.md) [up](../README.md#top) [web](https://example.test/x.md) [here](#ops) [site](/llms.txt)\n'
      + '`[code](nowhere.md)`\n\n```md\n[fenced](nowhere.md)\n```\n\n[ref]: ./also-missing.md\n';
    const problems = validate(tree({ 'docs/operations.md': doc }));
    expect(problems.filter((problem) => problem.startsWith('R6'))).toEqual([
      'R6 docs/operations.md:3: link missing.md resolves to docs/missing.md, which is not a tracked file',
      'R6 docs/operations.md:10: link ./also-missing.md resolves to docs/also-missing.md, which is not a tracked file',
    ]);
    expect(markdownLinks('[a](b.md "title") ![img](<c d.png>)').map((link) => link.target)).toEqual(['b.md', 'c d.png']);
  });

  it('R7: repo paths, npm scripts and identifiers in code spans must exist; placeholders, URLs and prose do not count', () => {
    const doc = [
      '# Ops', '',
      'Bad: `scripts/ci/gone.mjs`, `services/app/lib/thing/nope.ts:3`, `services/app/{lib,web}`, `lib/thing/missing`, `nothere.json`.',
      'Bad: `npm run nope -- --x`, `npm run -w services/app absent`, `makeNothing()`, `MISSING_SETTING`, `caps.css`.',
      'Fine: `lib/thing` (services/app), `scripts/ci/*.mjs`, `services/app/lib/thing/index.ts:1-4`, `check.mjs`, `npm run dev`.',
      'Fine: `npm run build:reader -w services/app`, `makeThing()`, `APP__PORT`, `caps.sql`, `<dir>/AGENTS.md`, `https://x.test/a.md`, `/llms/a.md`.',
      'Not checked: `tmp/a.md`, `evals/README.md`, `.agent/BRIEF.md`, `node_modules/x/y.js`, `@afbin/state`, `~/a/b.md`, `two words.md`.',
      'Not checked: `unknownroot/a/b`, `short`, `lowercase_word`, `Capital`, `a|b`, `test:{api,node}`.',
    ].join('\n');
    const problems = validate(tree({ 'docs/operations.md': doc })).filter((problem) => problem.startsWith('R7'));
    expect(problems).toEqual([
      'R7 docs/operations.md:3: `scripts/ci/gone.mjs`: names no tracked file or directory (scripts/ci/gone.mjs)',
      'R7 docs/operations.md:3: `services/app/lib/thing/nope.ts:3`: names no tracked file or directory (services/app/lib/thing/nope.ts)',
      'R7 docs/operations.md:3: `services/app/{lib,web}`: names no tracked file or directory (services/app/web)',
      'R7 docs/operations.md:3: `lib/thing/missing`: names no tracked file or directory (lib/thing/missing)',
      'R7 docs/operations.md:3: `nothere.json`: no tracked file has this name',
      'R7 docs/operations.md:4: `npm run nope -- --x`: no package.json defines the script "nope"',
      'R7 docs/operations.md:4: `npm run -w services/app absent`: no package.json defines the script "absent"',
      'R7 docs/operations.md:4: `makeNothing()`: this identifier occurs in no tracked source file',
      'R7 docs/operations.md:4: `MISSING_SETTING`: this identifier occurs in no tracked source file',
      'R7 docs/operations.md:4: `caps.css`: no tracked file has this name',
    ]);
  });

  it('R7: a path may be relative to the file\'s own directory, and the dated records are not read', () => {
    expect(validate(tree({ [scopedAgents]: '# Platform\n\n`../thing/index.ts` and `CLAUDE.md`, `../../solid/view`.\n' }))).toEqual([]);
    const record = '# Old\n\n`scripts/gone.mjs`\n';
    expect(validate(tree({ 'docs/resolver-latency.md': record, 'docs/dataset-read-latency.md': record, 'README.md': '[a](docs/resolver-latency.md) [b](docs/dataset-read-latency.md) [c](docs/operations.md)\n' }))).toEqual([]);
    expect(validate(tree({ 'docs/http-api.md': record, 'README.md': '[a](docs/http-api.md) [c](docs/operations.md)\n' })))
      .toEqual(['R7 docs/http-api.md:3: `scripts/gone.mjs`: names no tracked file or directory (scripts/gone.mjs)']);
  });

  it('R7 spans follow CommonMark: double-backtick spans, no spans across a blank line, escaped table pipes', () => {
    expect(codeSpans('a ``x ` y`` b `c\\|d` e `open\n\nclose`').map((span) => span.span)).toEqual(['x ` y', 'c|d']);
  });

  it('R8: every docs/*.md is linked from README.md, CONTRIBUTING.md or an AGENTS.md', () => {
    const problems = validate(tree({ 'docs/http-api.md': '# HTTP\n', 'docs/runner.md': '# Runner\n', [scopedAgents]: '# Platform\n\n[runner](../../../../docs/runner.md)\n', 'SECURITY.md': '[http](docs/http-api.md)\n' }));
    expect(problems.filter((problem) => problem.startsWith('R8'))).toEqual(['R8 docs/http-api.md: is linked from no README.md, CONTRIBUTING.md or AGENTS.md']);
  });

  it('R9: docs/scripts.md names every script directly in scripts/ and every scripts/ci/*.mjs', () => {
    const problems = validate(tree({ 'scripts/new.ts': '', 'scripts/ci/new-check.mjs': '', 'scripts/lib/helper.mjs': '', 'scripts/ci/list.json': '' }));
    expect(problems).toEqual(['R9 docs/scripts.md: does not name scripts/ci/new-check.mjs', 'R9 docs/scripts.md: does not name scripts/new.ts']);
    expect(validate(tree({ 'docs/scripts.md': undefined }))).toContainEqual(expect.stringMatching(/^R9 docs\/scripts\.md: is missing; it must name all 2 scripts/));
  });
});

const ROOT = path.resolve(import.meta.dirname, '../..');
const git = (args) => execFileSync('git', ['-C', ROOT, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

/** Tracked paths (deleted-but-unstaged ones dropped) → text for markdown and package.json, '' for the rest. */
function trackedTree() {
  const files = {};
  for (const file of git(['ls-files', '-z']).split('\0').filter(Boolean)) {
    const full = path.join(ROOT, file);
    if (!existsSync(full)) continue;
    files[file] = /\.md$|(?:^|\/)package\.json$/.test(file) ? readFileSync(full, 'utf8') : '';
  }
  return files;
}
/** The R7 identifiers that occur as a whole word in a tracked non-markdown file: one `git grep` for all of them, with
 * the validator's own pattern (PCRE, ~4x faster than many -F patterns); -w -F where git was built without PCRE. */
function identifiersInRepository(candidates) {
  if (!candidates.size) return new Set();
  const grep = (how) => {
    try {
      return new Set(git(['grep', '-I', '-h', '-o', ...how, '--', ...IDENTIFIER_PATHSPECS]).split('\n').filter(Boolean));
    } catch (error) {
      if (error.status === 1) return new Set();
      throw error;
    }
  };
  try { return grep(['-P', '-e', identifierPattern(candidates)]); } catch { return grep(['-w', '-F', ...[...candidates].flatMap((id) => ['-e', id])]); }
}

describe('the real repository', () => {
  it('keeps the markdown layout and its instruction files (R1–R9)', () => {
    const files = trackedTree();
    const problems = validateMarkdownTree(files, identifiersInRepository(referencedIdentifiers(files)));
    expect(problems, `\n${problems.join('\n')}\n`).toEqual([]);
  });
});
