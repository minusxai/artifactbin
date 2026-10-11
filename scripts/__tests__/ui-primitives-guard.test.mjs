/**
 * The UI-primitive guard must bite: each rule is shown a synthetic offender outside solid/ui, the same
 * text inside solid/ui passes, and the allowlist ratchets (a count may neither rise nor silently fall).
 */
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const GUARD = path.join(ROOT, 'scripts', 'ci', 'check-ui-primitives.mjs');
const temporary = [];

afterEach(() => {
  for (const directory of temporary.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

function repository(files, allowlist = []) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'artifactbin-ui-guard-'));
  temporary.push(root);
  for (const [file, content] of Object.entries(files)) {
    const target = path.join(root, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
  const allowlistPath = path.join(root, 'allowlist.json');
  fs.writeFileSync(allowlistPath, JSON.stringify(allowlist));
  execFileSync('git', ['-C', root, 'init', '-q']);
  return { root, allowlistPath };
}

const run = ({ root, allowlistPath }) => {
  const result = spawnSync(process.execPath, [GUARD, '--root', root, '--allowlist', allowlistPath], { encoding: 'utf8' });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
};

const OFFENDERS = {
  'native-select': '<select aria-label="Role"><option>a</option></select>',
  'popup-role': '<div role="menu">x</div>',
  overlay: '<div class="fixed inset-0 bg-surface" />',
  'native-title': '<span title="hint">x</span>',
  'styled-button': '<button type="button"\n  class="rounded px-2">Go</button>',
  'styled-field': '<input type="email" class="border" />',
  'arbitrary-radius': '<div class="rounded-[5px]" />',
  'arbitrary-text': '<p class="text-[11px]" />',
  'raw-color': "const ink = '#c0392b';",
  'palette-color': '<p class="text-red-500 bg-black" />',
  'style-constant': "import { FORM_INPUT } from '../ui/FormControls';",
};

describe('UI-primitive guard', () => {
  it.each(Object.entries(OFFENDERS))('refuses %s outside solid/ui and allows it inside', (rule, text) => {
    const outside = run(repository({ 'services/app/solid/pages/Page.tsx': text }));
    expect(outside.status).toBe(1);
    expect(outside.output).toContain(rule);
    expect(run(repository({ 'services/app/solid/ui/Thing.tsx': text, 'services/app/solid/pages/__tests__/t.test.tsx': text })).status).toBe(0);
  });

  it('leaves component props, theme tokens and composed primitives alone', () => {
    const clean = '<Tooltip content="x"><Button title="t" class="w-full">Go</Button></Tooltip><Select ariaLabel="Role" /><a href="#top" class="rounded-control text-2xs bg-surface" />';
    expect(run(repository({ 'services/app/solid/pages/Page.tsx': clean })).status).toBe(0);
  });

  it.each([
    ['styled-button', '<button type="button" onClick={() => go()} class="rounded px-2">Go</button>'],
    ['styled-field', '<input onInput={(event) => set(event.currentTarget.value)} class="border" />'],
    ['native-title', '<span onClick={() => go()} title="hint">x</span>'],
  ])('still sees %s after an arrow-function attribute', (rule, text) => {
    const outside = run(repository({ 'services/app/solid/pages/Page.tsx': text }));
    expect(outside.status).toBe(1);
    expect(outside.output).toContain(rule);
  });

  it('does not run a tag scan past a comparison into the next tag', () => {
    const clean = '<span onClick={() => go(a > b)}>x</span><Button class="w-full">Go</Button><Dialog role="alertdialog" title="t" />';
    expect(run(repository({ 'services/app/solid/pages/Page.tsx': clean })).status).toBe(0);
  });

  it('ratchets the exact allowlisted count', () => {
    const files = { 'services/app/solid/pages/Page.tsx': '<select></select><select></select>' };
    const entry = (count) => [{ path: 'services/app/solid/pages/Page.tsx', rule: 'native-select', count }];
    expect(run(repository(files, entry(1))).status).toBe(1);
    expect(run(repository(files, entry(2))).status).toBe(0);
    const fell = run(repository(files, entry(3)));
    expect(fell.status).toBe(1);
    expect(fell.output).toContain('lower its allowlist entry');
  });
});
