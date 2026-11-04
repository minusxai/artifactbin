/**
 * Retired or contradictory phrasing never returns to what the scripts and the API print (skill rulings 2026-11-04):
 * one blocking watch mode, Tested:/Not tested: only, update_artifact, values not --param, a watch that takes over,
 * onResolverChange, and no timeout(1) or heredoc command suggestions. In the `pr fast` guard tier
 * (scripts/ci/guard-tests.json). The skill's prose (SKILL.md, references, examples) joins this list from its own PR.
 */
import {readdirSync, readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {expect, it} from 'vitest';
import {WATCH_LOOP} from '@/lib/artifact-wire';

const APP = fileURLToPath(new URL('../../../', import.meta.url));
const SCRIPTS = path.join(APP, 'skills/artifactbin/scripts');
const FILES = [
  ...readdirSync(SCRIPTS).filter(name => name.endsWith('.mjs')).map(name => path.join(SCRIPTS, name)),
  path.join(APP, 'lib/artifact-wire/monitoring-guidance.ts'),
  path.join(APP, 'lib/operations/registry.ts'),
  path.join(APP, 'lib/html-runtime/browser-client.ts'),
  path.join(APP, 'lib/html-runtime/browser-reader.ts'),
];
const RETIRED: Array<[string, RegExp]> = [
  ['background watch branch', /run_in_background/],
  ['Verified: wording', /Verified:/],
  ['retired operation name', /\bedit_artifact\b/],
  ['retired query flag', /--param\b/],
  ['refused second watch', /another watch is already running/],
  ['backend alias', /\bonBackendChange\b/],
  ['unchanged-publish advice', /Publish it unchanged/],
  ['timeout(1) command', /\b(?:g?timeout)(?:\(1\))?\s+\d+\S*\s+node\b/],
  ['heredoc example', /<<-?\s*['"]?[A-Z][A-Z_]*['"]?\s*$/m],
];

it('keeps retired phrasing out of every script and API string it owns', () => {
  const found = FILES.flatMap(file => {
    const text = readFileSync(file, 'utf8');
    return RETIRED.filter(([, pattern]) => pattern.test(text)).map(([name]) => `${path.relative(APP, file)}: ${name}`);
  });
  expect(found).toEqual([]);
});

it('detects each retired phrasing it guards', () => {
  const samples = ['set run_in_background: true', 'Verified: 390x844', 'call edit_artifact', 'pass --param x=1',
    'another watch is already running', 'onBackendChange(fn)', 'Publish it unchanged.',
    'timeout 300 node scripts/comment.mjs watch ID --next', "cat > page.html <<'EOF'\n"];
  RETIRED.forEach(([name, pattern], index) => expect(pattern.test(samples[index]!), name).toBe(true));
  // The one timeout sentence the watch help prints is not a command suggestion.
  expect(RETIRED.some(([, pattern]) => pattern.test('never wrap the command in timeout(1).'))).toBe(false);
});

it('keeps the monitor instruction and the served watch guide on the same loop sentence (H1 drift)', () => {
  const guide = readFileSync(path.join(APP, 'skills/artifactbin/references/html-operations.md'), 'utf8');
  const section = guide.slice(guide.indexOf('## Watch for comments'));
  expect(section.slice(0, section.indexOf('\n## ', 3))).toContain(WATCH_LOOP);
});
