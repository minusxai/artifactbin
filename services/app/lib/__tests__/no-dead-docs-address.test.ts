/**
 * The docs became a skills tree, then ONE skill (`skills/artifact-bin/` over
 * `references/`, served at `/docs/artifact-bin/…`). Two generations of old
 * addresses answer 404 with no alias: the pre-tree pages (`/docs/llm`,
 * `/docs/artifact-design`, …) and the six-skill tree's directories
 * (`/docs/publishing`, `/docs/markup`, `/docs/themes`, `/docs/templates`,
 * `/docs/design` and every file under them).
 *
 * They were hard-coded in a dozen places that are NOT generated (a header
 * link, the paste string one agent hands another, the start tombstone, two
 * health checks, three gates, the eval's boot wait), found by grep during
 * the port. Same reflex as no-dead-api-link: a retired address gets a test,
 * not a memory, so a link to it fails where it is written.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '../../../..');

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist' || entry === '.metrics' || entry.startsWith('.')) continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (/\.(tsx?|mjs|yml|yaml)$/.test(entry) && !full.includes('__tests__') && !full.includes('routes.generated')) out.push(full);
  }
  return out;
}

/**
 * The retired addresses. The pre-tree pages died bare or with a query; the
 * six-skill directories died with their WHOLE subtree (`/docs/markup`,
 * `/docs/markup/SKILL.md`, `/docs/templates/deck.md`, …) — everything under
 * `/docs/` except `artifact-bin` and `human` is dead.
 */
const RETIRED = /\/docs\/(?:llm|artifact-design|publishing|markup|themes|templates|design)(?![\w-])/;

describe('no live address points at a retired docs page', () => {
  it('nothing outside comments names /docs/llm, /docs/markup, /docs/themes, /docs/templates or /docs/artifact-design', () => {
    const offenders: string[] = [];
    for (const dir of ['services/app/app', 'services/app/components', 'services/app/lib', 'services/app/server', 'scripts', 'evals', 'services/app/web', '.github']) {
      const full = path.join(ROOT, dir);
      let files: string[] = [];
      try { files = sourceFiles(full); } catch { continue; }
      for (const file of files) {
        for (const [i, line] of readFileSync(file, 'utf8').split('\n').entries()) {
          // Prose ABOUT the old pages (a measured-run note, a why-comment) may
          // still name them; a live string or route may not.
          const code = line.replace(/\/\/.*$/, '').replace(/^\s*\*.*$/, '').replace(/^\s*#.*$/, '');
          if (RETIRED.test(code)) offenders.push(`${path.relative(ROOT, file)}:${i + 1}: ${line.trim().slice(0, 100)}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the docker-compose and README point at the tree', () => {
    for (const f of ['docker-compose.yml', 'README.md']) {
      const text = readFileSync(path.join(ROOT, f), 'utf8');
      expect(text, f).not.toMatch(RETIRED);
    }
  });

  it('is actually looking at something (the scan cannot silently find nothing)', () => {
    const scanned = [...sourceFiles(path.join(ROOT, 'services/app/app')), ...sourceFiles(path.join(ROOT, 'services/app/lib'))];
    expect(scanned.length).toBeGreaterThan(50);
  });
});
