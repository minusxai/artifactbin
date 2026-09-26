/**
 * A downloaded file, edited the way a coding agent edits it: read the note at
 * the top, change the top-level "source" string inside the `#afbin-file` JSON
 * (a JSON round-trip, or a regex on the first "source"), leave everything else
 * alone. Opening it rebuilds the rest (lib/offline/file-backend's
 * rebuildArtifactFile); scripts/gate-offline-file.mjs opens the same kind of
 * edited file in three engines.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseArtifactFile, type ArtifactFile } from '../file-format';
import { renderArtifactFileHtml } from '../file-html';
import { CHANGED_OUTSIDE, rebuildArtifactFile, sourceChangedOutside } from '../file-backend';

const FIXTURE = path.resolve(process.cwd(), '../../scripts/fixtures/offline-file/artifact-file.json');
const CODE = 'H4sIAAAAAAAAA0tMTgYAQGCRmgQAAAA=';
const downloaded = () => renderArtifactFileHtml({ file: parseArtifactFile(JSON.parse(readFileSync(FIXTURE, 'utf8'))), code: CODE });

const BLOCK = /(<script type="application\/json" id="afbin-file">)([\s\S]*?)(<\/script>)/;
/** How the file reads itself back, minus the DOM: the JSON block, parsed and validated. */
const opened = (html: string): ArtifactFile => parseArtifactFile(JSON.parse(BLOCK.exec(html)![2]!));

/** An agent's JSON round-trip: parse the block, change `source`, write it back with plain JSON.stringify. */
const viaJson = (html: string, edit: (source: string) => string) => html.replace(BLOCK, (_all, open: string, json: string, close: string) => {
  const value = JSON.parse(json) as { source: string };
  value.source = edit(value.source);
  return `${open}${JSON.stringify(value)}${close}`;
});

describe('an offline file edited by an agent', () => {
  it('tells the agent, first, which string to change', () => {
    const html = downloaded();
    const note = /^<!doctype html>\n<!-- ([^\n]*) -->\n/.exec(html)?.[1];
    expect(note).toContain('change the top-level "source" string');
    expect(note).toContain('Leave "#afbin-code" untouched');
    // The JSON comes before the megabytes of code, so a reader that stops early still has it.
    expect(html.indexOf('id="afbin-file"')).toBeLessThan(html.indexOf('id="afbin-code"'));
  });

  it('opens with the new text and a journal line after a JSON round-trip of the source', async () => {
    const html = viaJson(downloaded(), (source) => source.replace('Regional sales</h1>', 'Quarterly sales</h1>'));
    const file = opened(html);
    expect(file.source).toContain('Quarterly sales</h1>');
    expect(file.base.source).toContain('Regional sales</h1>');
    expect(sourceChangedOutside(file)).toBe(true);
    const { file: rebuilt, error } = await rebuildArtifactFile(file);
    expect(error).toBeNull();
    expect(JSON.stringify(rebuilt.island.nodes)).toContain('Quarterly sales');
    expect(rebuilt.journal.map((entry) => entry.summary)).toEqual([CHANGED_OUTSIDE]);
    // Saved, it is consistent again: nothing left to rebuild.
    const saved = opened(renderArtifactFileHtml({ file: rebuilt, code: CODE }));
    expect(sourceChangedOutside(saved)).toBe(false);
  });

  it('edits the top-level source when the agent takes the first "source" in the text', async () => {
    const html = downloaded().replace(/("source":")((?:[^"\\]|\\.)*)"/, (_all, key: string, value: string) => `${key}${value.replace('Regional sales\\u003c/h1>', 'Regional revenue\\u003c/h1>')}"`);
    const file = opened(html);
    expect(file.source).toContain('Regional revenue</h1>');
    expect(file.base.source).not.toContain('Regional revenue');
    const { file: rebuilt } = await rebuildArtifactFile(file);
    expect(JSON.stringify(rebuilt.island.nodes)).toContain('Regional revenue');
  });

  it('keeps the last good render and says why when the markup is invalid', async () => {
    const good = opened(downloaded());
    const file = opened(viaJson(downloaded(), (source) => source.replace('<Button run', '<p>{$missing}</p>\n  <Button run')));
    const result = await rebuildArtifactFile(file);
    expect(result.error).toMatch(/\$missing.* refers to nothing declared/);
    expect(result.rebuilt).toBe(false);
    expect(result.file.island).toEqual(good.island);
    expect(result.file.css).toEqual(good.css);
  });
});
