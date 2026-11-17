/**
 * Every page a browser gate builds still parses and imports only what the platform serves.
 *
 * Gates run on main only. #1263 removed deprecated data APIs and retired the Mermaid and deck.gl hosted components;
 * the private-preview-save gate's portable page was rewritten with a syntax error (`…};` became `…});`) and the
 * html-rich-components fixture still imported `/components/mermaid.js`, and both broke main after merge. This reads
 * every page the manifest's gates build or publish (scripts/lib/gate-pages.mjs: evaluated from the gate sources,
 * none run) and checks, in pr fast, that each inline script parses and that each `@afbin/` and hosted-component import
 * names something the build ships: the runtime modules (lib/html-runtime/build.server.ts's import map), the hosted
 * libraries (lib/libraries/registry.json) and the hosted components (lib/html-components/hosted.json).
 * Each publish body is sent through the real publish handlers by services/app/__tests__/gate-publish.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { GATE_SPECS } from '../gates.manifest.mjs';
import { gateInputs, pageProblems, pageScripts, servedModules } from '../lib/gate-pages.mjs';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const read = (file) => readFileSync(path.join(ROOT, file), 'utf8');

const inputs = await gateInputs(ROOT);
const served = servedModules(ROOT);
const pages = [...inputs.pages, ...inputs.publishes.filter(({ body }) => typeof body.html === 'string').map(({ at, body }) => ({ at, html: body.html }))];

describe('the pages browser gates build', () => {
  it('reads every gate, its publish bodies and its pages, and evaluates each one', () => {
    expect(inputs.failures).toEqual([]);
    expect(inputs.unrouted).toEqual([]);
    // Bodies nothing here can read: what the installed skill prepares from the archive a gate downloads at run time
    // (a design system's theme page, a component baseline bundle). A new one fails until it is evaluable or named here.
    expect([...new Set(inputs.unseen.map((at) => at.split(':')[0]))].sort()).toEqual(['scripts/fixtures/component-baseline/publication.mjs', 'scripts/gates/gate-kit-and-fonts.mjs']);
    expect(inputs.publishes.length).toBeGreaterThan(80);
    expect(inputs.pages.length).toBeGreaterThan(120);
    expect(pages.flatMap(({ html }) => pageScripts(html)).filter(({ type }) => type === 'module').length).toBeGreaterThan(60);
    // Every gate that names an artifacts route and a content field yields a body, read from itself or a helper it calls.
    const publishing = GATE_SPECS.map(({ name }) => `scripts/gates/gate-${name}.mjs`)
      .filter((file) => /\/api\/(?:my\/)?artifacts\b/.test(read(file)) && /\b(?:html|dataset|image|pdf|file)\s*:/.test(read(file)));
    expect(publishing.length).toBeGreaterThan(15);
    const found = new Set(inputs.publishes.flatMap(({ at }) => at.split(/ via |:\d+/).filter((part) => part.startsWith('scripts/gates/gate-'))));
    expect(publishing.filter((file) => !found.has(file))).toEqual([]);
  });

  it('parses every inline script and imports only modules and hosted components the build ships', () => {
    const problems = pages.flatMap(({ at, html }) => pageProblems(html, served).map((problem) => `${at}: ${problem}`));
    expect([...new Set(problems)]).toEqual([]);
  });

  it('would have caught the #1263 syntax error and the retired Mermaid component', () => {
    const page = '<!doctype html><html><head><script type="module">import {state} from \'@afbin/state\';const draw=data=>{document.title=String(data.count);});state.subscribe(draw);</script></head><body></body></html>';
    expect(pageProblems(page, served)).toEqual([expect.stringContaining('a module script does not parse')]);
    expect(pageProblems('<script type="module">import \'/components/mermaid.js\';import {x} from \'@afbin/apollo-v0\';</script>', served))
      .toEqual(['loads /components/mermaid.js, a hosted component the build does not ship', 'imports @afbin/apollo-v0, which the build does not ship']);
    expect(pageProblems(page.replace('});', '};'), served)).toEqual([]);
  });
});
