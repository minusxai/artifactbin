/**
 * The UI-primitive guard must bite: each rule is shown a synthetic offender outside solid/ui, the same
 * text inside solid/ui passes, the allowlist ratchets (a count may neither rise nor silently fall), and the
 * documented exceptions (colors that are data) are exact, justified and never double-booked with the ratchet.
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

function repository(files, allowlist = [], exceptions = []) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'artifactbin-ui-guard-'));
  temporary.push(root);
  for (const [file, content] of Object.entries(files)) {
    const target = path.join(root, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
  const allowlistPath = path.join(root, 'allowlist.json');
  fs.writeFileSync(allowlistPath, JSON.stringify(allowlist));
  const exceptionsPath = path.join(root, 'exceptions.json');
  fs.writeFileSync(exceptionsPath, JSON.stringify(exceptions));
  execFileSync('git', ['-C', root, 'init', '-q']);
  return { root, allowlistPath, exceptionsPath };
}

const run = ({ root, allowlistPath, exceptionsPath }) => {
  const result = spawnSync(process.execPath, [GUARD, '--root', root, '--allowlist', allowlistPath, '--exceptions', exceptionsPath], { encoding: 'utf8' });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
};

const OFFENDERS = {
  'native-select': '<select aria-label="Role"><option>a</option></select>',
  'popup-role': '<div role="menu">x</div>',
  overlay: '<div class="fixed inset-0 bg-surface" />',
  'native-disclosure': '<details open><summary>DNS records</summary><p>x</p></details>',
  'native-title': '<span title="hint">x</span>',
  'styled-button': '<button type="button"\n  class="rounded px-2">Go</button>',
  'styled-field': '<input type="email" class="border" />',
  'arbitrary-radius': '<div class="rounded-[5px]" />',
  'arbitrary-text': '<p class="text-[11px]" />',
  'raw-color': "const ink = '#c0392b';",
  'palette-color': '<p class="text-red-500 bg-black" />',
  'style-constant': "import { FOCUS_RING } from '../ui/control-styles';",
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

  it.each([
    ['a control-styled link row', '<a href="/schedules" class="flex min-h-control-sm w-full items-center rounded-control px-2.5 hover:bg-raised">Schedule</a>'],
    ['a rounded link with a hover fill', '<a href={href()} download="" class="flex w-full items-center gap-2 rounded px-2 py-2 text-muted hover:bg-raised">x</a>'],
    ['a link drawn as a secondary button', '<a href="/x" onClick={() => go()} class="block rounded-lg border border-edge px-3 py-2 hover:border-accent">x</a>'],
    ['a control-look class constant', "const ROW = 'flex min-h-control-sm w-full items-center gap-2 rounded-control px-2.5 text-left';"],
    ['an exported control-look constant without a hover', "export const MENU_ROW = 'flex w-full items-center rounded-control px-3 py-3 font-mono text-sm';"],
    ['a template control-look constant', 'const RAIL_LINK = `flex h-control-sm items-center rounded-control px-2.5 hover:bg-raised`;'],
  ])('refuses %s outside solid/ui (link-control) and allows it inside', (_, text) => {
    const outside = run(repository({ 'services/app/solid/pages/Page.tsx': text }));
    expect(outside.status).toBe(1);
    expect(outside.output).toContain('link-control');
    // Inside ui the look is the library's own (an exported constant there is control-constant's concern, not this rule's).
    expect(run(repository({ 'services/app/solid/ui/Thing.tsx': text })).output).not.toContain('link-control');
  });

  it('leaves text links, surfaces and inline code styles alone (link-control)', () => {
    const clean = [
      "import { LINK } from '../ui/ui';",
      '<a href="/notifications" class={LINK}>All</a><a href="/x" class="text-accent no-underline hover:underline underline-offset-4">x</a>',
      '<a href="/@ada" class="rounded-chip underline-offset-4 hover:text-accent hover:underline">ada</a>',
      '<a href={url} class="flex items-center justify-between gap-4 border-b border-edge px-3 py-4 hover:bg-raised">row</a>',
      '<div class="rounded-control bg-raised p-3 font-mono text-xs">code</div>',
      "const CODE_CLASS = 'break-all rounded-chip bg-raised px-1 py-0.5 font-mono text-fg';",
      "const SECTION = 'font-sans text-lg font-semibold';",
    ].join('\n');
    expect(run(repository({ 'services/app/solid/pages/Page.tsx': clean })).status).toBe(0);
  });

  it('does not run a tag scan past a comparison, nor count an iframe title (its accessible name)', () => {
    const clean = '<span onClick={() => go(a > b)}>x</span><Button class="w-full">Go</Button><Dialog role="alertdialog" title="t" /><iframe src={u} title="Context document" />';
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
  it('refuses an exported class-string constant for a control inside solid/ui, but only the named page column and link styles in ui.tsx and the internal control-styles module', () => {
    const constant = "export const FORM_INPUT = 'w-full rounded-control border';";
    const inside = run(repository({ 'services/app/solid/ui/Thing.tsx': constant }));
    expect(inside.status).toBe(1);
    expect(inside.output).toContain('control-constant');
    const grabBag = run(repository({ 'services/app/solid/ui/ui.tsx': "export const LINK = 'text-accent';\nexport const FORM_PRIMARY_BUTTON = 'rounded-lg px-4';" }));
    expect(grabBag.status).toBe(1);
    expect(grabBag.output).toContain('control-constant');
    expect(run(repository({ 'services/app/solid/ui/ui.tsx': "export const PAGE_COLUMN = 'mx-auto';\nexport const LINK = 'text-accent';" })).status).toBe(0);
    expect(run(repository({ 'services/app/solid/ui/control-styles.ts': "export const FOCUS_RING = 'outline-none';" })).status).toBe(0);
    expect(run(repository({ 'services/app/solid/ui/Thing.tsx': "const LOCAL = 'w-full'; export const LAYER = { dialog: 40 };" })).status).toBe(0);
  });

  it('scans the offline file chrome in lib/ and leaves document content kits unscanned', () => {
    const offender = '<button type="button" class="rounded px-2">Go</button>';
    const offline = run(repository({ 'services/app/lib/offline/solid-entry.tsx': offender }));
    expect(offline.status).toBe(1);
    expect(offline.output).toContain('styled-button');
    expect(run(repository({ 'services/app/lib/islands/kit/select.tsx': offender, 'services/app/lib/frame-edit/GridEdit.tsx': offender, 'services/app/lib/offline/__tests__/t.test.tsx': offender })).status).toBe(0);
  });

  describe('documented exceptions', () => {
    const files = { 'services/app/solid/pages/Chat.tsx': "const a = '#111214', b = '#e6e6e6';" };
    const exception = (count, reason = 'xterm paints its own canvas: the colors are data, not theme tokens') => [{ path: 'services/app/solid/pages/Chat.tsx', rule: 'raw-color', count, reason }];

    it('allows exactly the documented count and prints both totals', () => {
      const result = run(repository(files, [], exception(2)));
      expect(result.status).toBe(0);
      expect(result.output).toContain('0 ratcheted');
      expect(result.output).toContain('1 documented exceptions');
    });

    it('refuses one more use than documented, and a documented use that went away', () => {
      const more = run(repository(files, [], exception(1)));
      expect(more.status).toBe(1);
      expect(more.output).toContain('1 new raw-color');
      const fewer = run(repository(files, [], exception(3)));
      expect(fewer.status).toBe(1);
      expect(fewer.output).toContain('exception');
      expect(fewer.output).toContain('raw-color');
    });

    it.each([['', 'empty'], [undefined, 'missing'], ['   ', 'blank']])('requires a reason (%s)', (reason) => {
      const entry = [{ path: 'services/app/solid/pages/Chat.tsx', rule: 'raw-color', count: 2, ...(reason === undefined ? {} : { reason }) }];
      const result = run(repository(files, [], entry));
      expect(result.status).toBe(1);
      expect(result.output).toContain('reason');
    });

    it('refuses an entry that is also in the migration ratchet', () => {
      const result = run(repository(files, [{ path: 'services/app/solid/pages/Chat.tsx', rule: 'raw-color', count: 2 }], exception(2)));
      expect(result.status).toBe(1);
      expect(result.output).toContain('both');
    });

    it('keeps the ratchet for everything else on the same file', () => {
      const mixed = { 'services/app/solid/pages/Chat.tsx': "const a = '#111214';<select></select>" };
      const entries = [{ path: 'services/app/solid/pages/Chat.tsx', rule: 'raw-color', count: 1, reason: 'terminal theme' }];
      expect(run(repository(mixed, [], entries)).status).toBe(1);
      expect(run(repository(mixed, [{ path: 'services/app/solid/pages/Chat.tsx', rule: 'native-select', count: 1 }], entries)).status).toBe(0);
    });
  });
});
