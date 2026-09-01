/**
 * The theme lineup is six dual-palette themes; `classical`, `broadsheet` and
 * `nocturne` are RETIRED — stored rows alias forward through
 * `resolveStoredStoryDesign`, and publish rejects the names with a hint.
 *
 * Same reasoning as no-dead-format: the retirement touched the registry, the
 * publish gate, the MCP schema, the docs, the guidance yaml, the seeds and the
 * gates — a leftover in any one of them is a contract an agent will believe.
 * So the rule gets a test rather than a memory.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '../..');

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next' || entry === 'dist' || entry.startsWith('.')) continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (/\.(tsx?|mjs)$/.test(entry) && !full.includes('__tests__') && !/\.test\./.test(entry)) out.push(full);
  }
  return out;
}

const FILES = ['app', 'components', 'lib', 'scripts', 'orchestrator'].flatMap((d) => sourceFiles(path.join(ROOT, d)));

// The one file allowed to speak retired names: the alias table itself.
const ALIAS_HOME = path.join(ROOT, 'lib/data/story/story-themes.ts');

/** A retired theme name used as a VALUE (quoted string), not prose. */
const RETIRED_VALUE = /['"](classical|broadsheet|nocturne)['"]/;

describe('retired themes are dead names', () => {
  it('no source file uses a retired theme name as a value outside the alias table', () => {
    const hits: string[] = [];
    for (const file of FILES) {
      if (file === ALIAS_HOME) continue;
      const lines = readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, i) => {
        if (/^\s*[*]/.test(line)) return; // block-comment prose
        const code = line.replace(/\/\/.*$/, '');
        if (RETIRED_VALUE.test(code)) {
          hits.push(`${path.relative(ROOT, file)}:${i + 1} — ${line.trim()}`);
        }
      });
    }
    expect(hits).toEqual([]);
  });

  it('is actually looking at something (the scan cannot silently find nothing)', () => {
    expect(FILES.length).toBeGreaterThan(50);
    expect(FILES).toContain(ALIAS_HOME);
  });

  it('the theme vocabulary itself lists exactly the surviving six', async () => {
    const { STORY_THEME_NAMES } = await import('@/lib/validation/atlas-schemas');
    expect([...STORY_THEME_NAMES]).toEqual(['modernist', 'organic', 'industry', 'terminal', 'manuscript', 'pop']);
  });

  it('the theme docs (references/themes-*.md) teach only the surviving six', () => {
    const files = readdirSync(path.join(ROOT, 'skills/artifactbin/references'))
      .filter((f) => f.startsWith('themes-'))
      .map((f) => f.replace(/^themes-/, '').replace(/\.md$/, ''))
      .sort();
    expect(files).toEqual(['industry', 'manuscript', 'modernist', 'organic', 'pop', 'terminal']);
  });
});
