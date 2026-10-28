/**
 * A stored drawing is valid only for the engine that drew it
 * (lib/mermaid-images/engine). These pins make the engine string move when
 * what the engine draws can: the installed Pele runtime, and the kit's render
 * module. Changing lib/mermaid-images/mermaid-render? Bump
 * MERMAID_KIT_RENDER_VERSION and record the new hash below — every stored
 * drawing is then ignored until the harvest redraws it.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { MERMAID_KIT_RENDER_VERSION, MERMAID_RENDER_ENGINE, mermaidPrerenderable } from '../engine';

const RENDER_MODULE_SHA256 = '3f57825be203725bf1bf3db9bfc21c5e5910ba0c97ac061a30a90b314c9cd8c3';

describe('the retained Mermaid-syntax render engine identity', () => {
  it('names the installed Pele runtime', () => {
    const installed = (createRequire(import.meta.url)('pele/package.json') as { version: string }).version;
    expect(MERMAID_RENDER_ENGINE).toBe(`pele@${installed}+kit${MERMAID_KIT_RENDER_VERSION}`);
  });
  it('is bumped with the kit render module (hash pinned here)', () => {
    const source = readFileSync(path.resolve(import.meta.dirname, '../mermaid-render.ts'));
    expect(createHash('sha256').update(source).digest('hex'), 'lib/mermaid-images/mermaid-render changed: bump MERMAID_KIT_RENDER_VERSION and update this hash').toBe(RENDER_MODULE_SHA256);
  });
  it('never prerenders a gantt chart (its "today" line moves), a cynefin chart (seeded by page order), a C4 diagram (its own system fonts) or a code the kit refuses', () => {
    expect(mermaidPrerenderable('gantt\n  title Plan')).toBe(false);
    expect(mermaidPrerenderable('cynefin-beta\n  title T')).toBe(false);
    // C4 draws in its own system font stack, measured differently per machine.
    expect(mermaidPrerenderable('C4Context\n  title System\n  Person(p, "User")')).toBe(false);
    expect(mermaidPrerenderable('%%{init: {}}%%\nflowchart LR\n a-->b')).toBe(false);
    expect(mermaidPrerenderable('flowchart LR\n  a --> b')).toBe(true);
    expect(mermaidPrerenderable('classDiagram\n  A <|-- B')).toBe(true);
  });
});
