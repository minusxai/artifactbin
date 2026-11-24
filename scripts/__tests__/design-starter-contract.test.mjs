/** The shipped CSS and HTML starters agree on the generator's portable design-system contract. */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { expect, it } from 'vitest';
import { REPO, ROSTER, SHARED_TOKENS, SHARED_TYPE_ROLES } from '../../design-systems/lib/pages.mjs';

const skill = path.join(REPO, 'services/app/skills/artifactbin');
const read = file => readFileSync(path.join(skill, file), 'utf8');
const names = (text, pattern) => Array.from(text.matchAll(pattern), match => match[1]);
const headerList = (header, label) =>
  header.match(new RegExp(`^ \\* ${label}[^\\n]*\\n((?: \\*   [^\\n]+\\n)+)`, 'm'))?.[1].replace(/^ \* +/gm, '').trim().split(/\s+/);

it('every shipped system defines the tokens and type roles its header promises', () => {
  const files = readdirSync(path.join(skill, 'design-systems'));
  expect(files.sort()).toEqual(ROSTER.map(name => name + '.css').sort());
  for (const name of ROSTER) {
    const css = read(`design-systems/${name}.css`);
    const header = css.slice(0, css.indexOf('*/'));
    expect(headerList(header, 'Shared contract:'), name).toEqual(SHARED_TOKENS);
    expect(headerList(header, 'Type-role classes'), name).toEqual(SHARED_TYPE_ROLES);
    const defined = new Set(names(css.slice(header.length + 2), /^  (--[\w-]+):/gm));
    for (const token of SHARED_TOKENS) expect(defined.has(token), `${name} ${token}`).toBe(true);
    for (const role of SHARED_TYPE_ROLES) expect(css, name).toContain(` .${role} {`);
    expect(header, name).toMatch(/^ \* Use for: /m);
    expect(header, name).not.toMatch(/^ \* Fits: /m);
  }
});

it('each shipped HTML starter uses only portable or locally defined tokens and type roles', () => {
  for (const file of readdirSync(path.join(skill, 'examples')).filter(file => file.endsWith('.html'))) {
    const html = read(`examples/${file}`);
    const source = html + names(html, /<script[^>]*\bsrc="\.\/([\w-]+\.mjs)"/g).map(script => read(`examples/${script}`)).join('\n');
    const css = names(html, /<style>([\s\S]*?)<\/style>/g).join('\n');
    const tokens = new Set([...SHARED_TOKENS, ...names(css, /(--[\w-]+)\s*:/g)]);
    const roles = new Set([...SHARED_TYPE_ROLES, ...names(css, /\.(t-[\w-]+)\b/g)]);
    const usedTokens = [...source.matchAll(/var\(\s*(--[\w-]+)|['"](--[\w-]*[a-z0-9])['"]/gi)]
      .map(match => match[1] ?? match[2]);
    for (const token of usedTokens) expect(tokens.has(token), `${file} ${token}`).toBe(true);
    for (const role of names(source, /\b(t-[a-z][\w-]*)\b/g)) expect(roles.has(role), `${file} ${role}`).toBe(true);
  }
});
