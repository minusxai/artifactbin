/**
 * testmig-4 seed — the harness is the ONLY place a test file builds a request, encodes an agent cookie, wipes
 * tables, or resets the database. Every copy of those four mechanisms outside `harness.ts` is a pin failure.
 *
 * Escape hatch, deliberately narrow: a file whose copy is the SUBJECT of its tests (the cookie codec's own
 * test, the schema-upgrade test that must build an old PGLite by hand) carries one line
 * `// harness-exempt: <reason>` — the pin skips that file for the mechanism named on that line and pin 5
 * caps how many such files may exist. An exemption without a reason is a failure.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const APP = path.resolve(import.meta.dirname, '..');
const OWN = new Set(['__tests__/harness.ts', '__tests__/harness.test.ts', '__tests__/harness-request.test.ts', '__tests__/harness-rollout.test.ts']);

const testFiles = (): string[] => {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === '.next') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.test\.tsx?$/.test(entry.name)) out.push(path.relative(APP, full));
    }
  };
  walk(APP);
  return out.filter((f) => !OWN.has(f)).sort();
};
const files = testFiles().map((rel) => ({ rel, text: fs.readFileSync(path.join(APP, rel), 'utf8') }));

type Mechanism = 'reset' | 'cookie' | 'request' | 'wipe';
const EXEMPT = /^\s*\/\/ harness-exempt: (reset|cookie|request|wipe)\b[^\n]*\S/m;
const exemptions = (text: string): Set<Mechanism> => {
  const set = new Set<Mechanism>();
  for (const m of text.matchAll(/^\s*\/\/ harness-exempt: (reset|cookie|request|wipe)\b(.*)$/gm)) {
    if (!m[2]?.trim().replace(/^[-—:]\s*/, '')) throw new Error(`harness-exempt without a reason: ${m[0].trim()}`);
    set.add(m[1] as Mechanism);
  }
  return set;
};
/** The body text of every beforeEach/afterEach/beforeAll/afterAll hook (brace-balanced, good enough for our files). */
const hookBodies = (text: string): string => {
  let out = '';
  const re = /\b(beforeEach|afterEach|beforeAll|afterAll)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const open = text.indexOf('{', m.index);
    if (open < 0) continue;
    let depth = 0;
    for (let i = open; i < text.length; i += 1) {
      if (text[i] === '{') depth += 1;
      else if (text[i] === '}') { depth -= 1; if (depth === 0) { out += text.slice(open, i + 1) + '\n'; break; } }
    }
  }
  return out;
};
const offenders = (mechanism: Mechanism, test: (text: string) => boolean): string[] =>
  files.filter(({ rel, text }) => !exemptions(text).has(mechanism) && test(text)).map(({ rel }) => rel);

describe('the harness owns the four mechanisms (testmig-4 rollout)', () => {
  it('1. no test file resets the database itself — one PGLite per file is the harness\'s job', () => {
    expect(offenders('reset', (t) => /\bresetDb\(/.test(t) || /new PGlite\(/.test(t))).toEqual([]);
  });
  it('2. no test file encodes an agent cookie itself', () => {
    expect(offenders('cookie', (t) => /\bencodeAgentSession\(/.test(t))).toEqual([]);
  });
  it('3. no test file defines its own request builder', () => {
    const builder = /^(export )?(const|function|async function) (req|request|call|hit|api|send|get|post|fetchApp|mkReq|makeRequest)\b\s*[=(:<]/m;
    expect(offenders('request', (t) => builder.test(t))).toEqual([]);
  });
  it('4. no hook wipes tables itself — no DELETE FROM / TRUNCATE / table-list loop inside beforeEach/afterEach/beforeAll/afterAll', () => {
    const wipe = /DELETE FROM|TRUNCATE|for \(const \w+ of \[?['"]?(artifacts|tokens|users|annotations|codes|datasets)/;
    expect(offenders('wipe', (t) => wipe.test(hookBodies(t)))).toEqual([]);
  });
  it('5. exemptions are few, named, and each says why', () => {
    const exempt = files.filter(({ text }) => EXEMPT.test(text)).map(({ rel, text }) => `${rel}: ${[...exemptions(text)].join(',')}`);
    expect(exempt.length, exempt.join('\n')).toBeLessThanOrEqual(6);
  });
  it('6. every test file that opens the app database goes through useAppHarness()', () => {
    const opensDb = (t: string) => /from ['"]@\/lib\/db['"]/.test(t) && /\bgetDb\(/.test(t);
    const missing = files.filter(({ rel, text }) => opensDb(text) && !/\buseAppHarness\(/.test(text) && !exemptions(text).has('reset') && !rel.startsWith('lib/__tests__/db')).map(({ rel }) => rel);
    expect(missing).toEqual([]);
  });
});
