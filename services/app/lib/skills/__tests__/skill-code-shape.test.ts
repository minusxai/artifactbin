/**
 * Decision D19: every hand-written code file the skill ships explains itself at the top and stays
 * short enough to read whole. The set is whatever loadSkillAssets ships (scripts, components,
 * examples, design systems), so a new file joins by existing. Exemptions are rules, not names:
 * compiled components (`components/*.js`, if any ship) are esbuild output; CSV examples are data (no header);
 * a stylesheet whose leading comment says "Generated from" is generated (header kept, length exempt).
 */
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {describe, expect, it} from 'vitest';
import {readFileSync} from 'node:fs';
import {loadSkillAssets} from '../assets';
import {skillTree, joinSoftBreaks} from '..';

const ROOT = fileURLToPath(new URL('../../../skills/artifactbin/', import.meta.url));
const MAX_LINES = 200;
const MAX_WIDTH = 100;

/** The first comment of a file (after a shebang or an HTML doctype), with comment markers and `*` gutters removed. */
function leadingComment(source: string): string | null {
  const match = /^(?:#![^\n]*\n)?(?:<!doctype html>\s*\n)?(\/\*[\s\S]*?\*\/|<!--[\s\S]*?--!?>)/i
    .exec(source);
  if (!match) return null;
  return match[1]!
    .replace(/^\/\*\*?|\*\/$|^<!--|--!?>$/g, '')
    .split('\n')
    .map(line => line.replace(/^\s*\* ?/, '').trimEnd())
    .join('\n')
    .trim();
}

type CodeKind = 'compiled' | 'data' | 'generated' | 'command' | 'component' | 'internal' | 'example';

/** Classify a shipped path by rule. */
function kindOf(name: string, source: string, commands: readonly string[]): CodeKind {
  if (/^components\/.*\.js$/.test(name)) return 'compiled';
  if (name.endsWith('.csv')) return 'data';
  if (name.endsWith('.css') && /Generated from/.test(leadingComment(source) ?? '')) return 'generated';
  const script = /^scripts\/([a-z0-9-]+)\.mjs$/.exec(name);
  if (script) return commands.includes(script[1]!) ? 'command' : 'internal';
  if (name.startsWith('examples/')) return 'example';
  if (/^<af-/.test(leadingComment(source) ?? '')) return 'component';
  return 'internal';
}

/** Header problems for one file, by kind. */
function headerProblems(kind: CodeKind, source: string): string[] {
  if (kind === 'compiled' || kind === 'data') return [];
  const problems: string[] = [];
  const need = (text: string, labels: string[]) => {
    for (const label of labels) if (!text.includes(label)) problems.push(`header lacks ${label}`);
  };
  if (kind === 'command') {
    const lines = source.split('\n');
    if (!/^\/\*\*? .*\*\/$|^\/\//.test(lines[0]!)) problems.push('line 1 is not a comment');
    if (!lines[1]?.startsWith('export const DESCRIPTION = `')) problems.push('line 2 is not DESCRIPTION');
    const description = /^export const DESCRIPTION = `([^`]*)`;$/m.exec(source)?.[1] ?? '';
    need(description, ['Usage:', 'Flags:', 'Examples:', 'Gotchas:']);
    return problems;
  }
  const comment = leadingComment(source);
  if (!comment) return ['no leading comment block'];
  if (kind === 'component') need(comment, ['Usage:', 'Props:', 'Examples:', 'Gotchas:']);
  if (kind === 'example') {
    if (!comment.startsWith('Example')) problems.push('example header does not start with Example');
    need(comment, ['Usage:', 'Gotchas:']);
  }
  if (kind === 'internal') {
    if (!comment.startsWith('Internal')) problems.push('internal header does not start with Internal');
    need(comment, ['Used by']);
  }
  return problems;
}

/** Length problems: generated and compiled files are exempt. */
function lengthProblems(kind: CodeKind, source: string): string[] {
  if (kind === 'compiled' || kind === 'generated') return [];
  const lines = source.replace(/\n$/, '').split('\n');
  const problems = lines.length > MAX_LINES ? [`${lines.length} lines, cap ${MAX_LINES}`] : [];
  lines.forEach((line, index) => {
    if (line.length > MAX_WIDTH) problems.push(`line ${index + 1} is ${line.length} chars`);
  });
  return problems;
}

describe('the rules', () => {
  const commands = ['publish'];
  it('classify by rule', () => {
    expect(kindOf('components/button.js', '', commands)).toBe('compiled');
    expect(kindOf('examples/rows.csv', 'a,b', commands)).toBe('data');
    expect(kindOf('design-systems/x.css', '/*\n * X. Generated from\n * specs */', commands)).toBe('generated');
    expect(kindOf('design-systems/x.css', '/* hand-written */', commands)).toBe('internal');
    expect(kindOf('scripts/publish.mjs', '', commands)).toBe('command');
    expect(kindOf('scripts/toolbox-x.mjs', '', commands)).toBe('internal');
    expect(kindOf('components/x.ts', '/**\n * <af-x>: a thing.\n */', commands)).toBe('component');
    expect(kindOf('components/x-model.ts', '/** Internal: x. Used by: x.ts */', commands)).toBe('internal');
    expect(kindOf('examples/a.html', '<!doctype html>\n<!--\nExample: a.\n-->', commands)).toBe('example');
  });
  it('find a missing header, a missing label and an over-long file', () => {
    expect(headerProblems('internal', 'export const x = 1;')).toEqual(['no leading comment block']);
    expect(headerProblems('component', '/**\n * <af-x>: x.\n * Usage: u\n * Props: p\n */\n'))
      .toEqual(['header lacks Examples:', 'header lacks Gotchas:']);
    const command = '/** c */\nexport const DESCRIPTION = `S\nUsage: u\nFlags: f\nExamples:\n  x\n`;\n';
    expect(headerProblems('command', command)).toEqual(['header lacks Gotchas:']);
    expect(lengthProblems('internal', 'x\n'.repeat(201))).toEqual(['201 lines, cap 200']);
    expect(lengthProblems('internal', 'y'.repeat(101))).toEqual(['line 1 is 101 chars']);
    expect(lengthProblems('generated', 'y'.repeat(101))).toEqual([]);
    expect(lengthProblems('compiled', 'y\n'.repeat(500))).toEqual([]);
  });
});

it('every shipped hand-written code file has its header and fits 200 lines of 100 columns', async () => {
  const {COMMANDS} = await import('../../../skills/artifactbin/scripts/toolbox-commands.mjs');
  const assets = loadSkillAssets(path.resolve(ROOT));
  const commands = Object.keys(COMMANDS);
  const problems: string[] = [];
  const kinds = new Set<CodeKind>();
  for (const [name, source] of Object.entries(assets)) {
    const kind = kindOf(name, source, commands);
    kinds.add(kind);
    for (const problem of [...headerProblems(kind, source), ...lengthProblems(kind, source)])
      problems.push(`${name}: ${problem}`);
  }
  expect(problems).toEqual([]);
  // Every rule has real files behind it, so a broken classifier cannot pass vacuously.
  for (const kind of ['generated', 'command', 'component', 'internal', 'example'] as const)
    expect(kinds, kind).toContain(kind);
});

// SKILL.md is outside the asset set: its source wraps at 100 columns too, and the tree joins the
// wrapped lines back so the served text keeps one paragraph, list item or table row per line.
it('SKILL.md fits 100 columns and only its soft wraps change when served', () => {
  const source = readFileSync(path.join(ROOT, 'SKILL.md'), 'utf8');
  const wide = source.split('\n').flatMap((line, index) =>
    line.length > MAX_WIDTH ? [`SKILL.md line ${index + 1} is ${line.length} chars`] : []);
  expect(wide).toEqual([]);
  const body = (text: string) => text.slice(text.indexOf('\n---\n') + 5);
  const served = joinSoftBreaks(body(source));
  expect(served.split(/\s+/)).toEqual(body(source).split(/\s+/));
  expect(served.split('\n').length).toBeLessThan(body(source).split('\n').length);
  expect(skillTree().get('artifactbin/SKILL.md')!.body).toBe(served);
  expect(joinSoftBreaks('- a\n  b 2)\nc\n1) d\n| x |\n| y\n  z |\n```\ne\nf\n```\ng')).toBe(
    '- a b 2) c\n1) d\n| x |\n| y z |\n```\ne\nf\n```\ng');
});
