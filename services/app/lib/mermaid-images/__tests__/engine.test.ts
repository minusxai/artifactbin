/**
 * A stored drawing is valid only for the engine that drew it
 * (lib/mermaid-images/engine). These pins make the engine string move when
 * what the engine draws can: the installed Mermaid, and the kit's render
 * module. Changing components/kit/mermaid-render? Bump
 * MERMAID_KIT_RENDER_VERSION and record the new hash below — every stored
 * drawing is then ignored until the harvest redraws it.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { MERMAID_KIT_RENDER_VERSION, MERMAID_RENDER_ENGINE, mermaidPrerenderable } from '../engine';

const RENDER_MODULE_SHA256 = 'b14f7d536dddb3a7bcccdf68253b884cc8c621bfcb876c577678ecd61f3551e8';

describe('the Mermaid render engine identity', () => {
  it('names the installed Mermaid', () => {
    const installed = (createRequire(import.meta.url)('mermaid/package.json') as { version: string }).version;
    expect(MERMAID_RENDER_ENGINE).toBe(`mermaid@${installed}+kit${MERMAID_KIT_RENDER_VERSION}`);
  });
  it('is bumped with the kit render module (hash pinned here)', () => {
    const source = readFileSync(path.resolve(import.meta.dirname, '../../../components/kit/mermaid-render.ts'));
    expect(createHash('sha256').update(source).digest('hex'), 'components/kit/mermaid-render changed: bump MERMAID_KIT_RENDER_VERSION and update this hash').toBe(RENDER_MODULE_SHA256);
  });
  it('never prerenders a gantt chart (its "today" line moves), a cynefin chart (seeded by page order) or a code the kit refuses', () => {
    expect(mermaidPrerenderable('gantt\n  title Plan')).toBe(false);
    expect(mermaidPrerenderable('cynefin-beta\n  title T')).toBe(false);
    expect(mermaidPrerenderable('%%{init: {}}%%\nflowchart LR\n a-->b')).toBe(false);
    expect(mermaidPrerenderable('flowchart LR\n  a --> b')).toBe(true);
    expect(mermaidPrerenderable('classDiagram\n  A <|-- B')).toBe(true);
  });
});
