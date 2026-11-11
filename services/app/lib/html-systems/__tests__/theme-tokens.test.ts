/**
 * THE THEME CONTRACT a host page relies on (THEME_TOKENS): the generator's shared keys, defined by every design system
 * for light and dark, stated in every stylesheet header the skill ships, and the only shared tokens components read.
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { expect, it } from 'vitest';
import { CONTRACT_KEYS } from '../../../../../design-systems/lib/pages.mjs';
import { HTML_SYSTEMS } from '../html-systems';
import { HTML_SYSTEM_NAMES, OPTIONAL_THEME_TOKENS, THEME_ATTRIBUTES, THEME_TOKENS } from '../index';

it('is the generator\'s shared keys, the radius and the three font roles', () => {
  expect([...THEME_TOKENS]).toEqual([...CONTRACT_KEYS.map((key: string) => `--${key}`), '--radius', '--font-display', '--font-body', '--font-mono']);
  expect(THEME_ATTRIBUTES).toEqual({ designSystem: 'data-af-design-system', dark: 'data-af-dark' });
});

it('every design system defines every token, and keys its dark values by the dark attribute', () => {
  expect(HTML_SYSTEM_NAMES.length).toBeGreaterThan(5);
  for (const name of HTML_SYSTEM_NAMES) {
    const rules = HTML_SYSTEMS[name as keyof typeof HTML_SYSTEMS].rules;
    const root = new RegExp(`:root\\[data-af-design-system="${name}"\\] \\{([^}]*)\\}`).exec(rules)?.[1] ?? '';
    for (const token of THEME_TOKENS) expect(root, `${name} ${token}`).toMatch(new RegExp(`(?:^|[;\\s])${token}:`));
    expect(rules, name).toContain(`:root[data-af-design-system="${name}"][data-af-dark="true"]`);
  }
});

it('every shipped design-system stylesheet header states exactly this list', () => {
  const dir = path.resolve('skills/artifactbin/design-systems');
  const files = readdirSync(dir).filter(file => file.endsWith('.css'));
  expect(files.length).toBeGreaterThan(5);
  for (const file of files) {
    const header = readFileSync(path.join(dir, file), 'utf8').split('*/')[0]!;
    const listed = /Shared contract:[^\n]*\n((?:\s*\*\s+--[^\n]*\n)+)/.exec(header)?.[1] ?? '';
    expect(listed.match(/--[a-z0-9-]+/g), file).toEqual([...THEME_TOKENS]);
  }
});

it('components read only contract tokens, the optional overrides and their own variables', () => {
  const dir = path.resolve('lib/html-components');
  const read = new Set<string>();
  for (const file of readdirSync(dir).filter(file => file.endsWith('.ts') && !file.endsWith('.test.ts')))
    for (const match of readFileSync(path.join(dir, file), 'utf8').matchAll(/var\((--[a-z0-9-]+)/g)) read.add(match[1]!);
  const allowed = new Set<string>([...THEME_TOKENS, ...OPTIONAL_THEME_TOKENS]);
  const foreign = [...read].filter(token => !allowed.has(token) && !/^--(?:af|ds|mx)-/.test(token));
  expect(foreign).toEqual([]);
  for (const token of ['--background', '--foreground', '--primary', '--border', '--radius']) expect(read.has(token), token).toBe(true);
});
