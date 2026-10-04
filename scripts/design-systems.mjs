#!/usr/bin/env node
/**
 * The design-systems generator: `npm run generate:design-systems [-- <mode> [slug ...]]`.
 *
 * One source, design-systems/specs/<slug>.json and design-systems/catalogue.json; three outputs:
 *
 *   runtime   services/app/lib/validation/story-system-names.ts and lib/data/story/story-systems.json —
 *             what the server serves a system from (committed; scripts/__tests__ fails on drift)
 *   skill     services/app/skills/artifactbin/references/design-systems.md and system-<slug>.md —
 *             what the agent reads (committed; the same test fails on drift)
 *   pages     tmp/design-systems/<slug>.jsx and index.jsx — the published specimen pages, publishing
 *             copies pushed with afbin (DS_PAGES_DIR overrides the folder; an existing page keeps its fence)
 *   fonts     refresh design-systems/fonts.json from Google Fonts for every family the specs name (network)
 *
 * No mode runs `runtime` and `skill`, the two committed outputs. Run it, review the diff, commit the output.
 */
import { writeRuntime } from '../design-systems/lib/runtime.mjs';
import { writeSkill } from '../design-systems/lib/skill.mjs';
import { writePages, ROSTER, loadSpec, REPO } from '../design-systems/lib/pages.mjs';
import { writeIndex } from '../design-systems/lib/index-page.mjs';
import { fetchFaces } from '../design-systems/lib/fonts.mjs';
import path from 'node:path';

const [mode = 'all', ...rest] = process.argv.slice(2);
const slugs = rest.length ? rest : ROSTER;
const rel = (p) => path.relative(REPO, p);
const report = (written) => { for (const { path: p, bytes } of written) console.log(`wrote ${rel(p)} ${bytes.toLocaleString('en-US')} bytes`); };

switch (mode) {
  case 'runtime': { const { files, entries } = writeRuntime(); report(files); for (const e of entries) console.log(`  ${e.name.padEnd(11)} vars ${String(Object.keys(e.cssVars).length).padStart(3)} fonts ${String(e.fontFaces.length).padStart(6)} css ${String(e.css.length).padStart(6)}`); break; }
  case 'skill': report(writeSkill(slugs)); break;
  case 'pages': report(writePages(slugs)); report([writeIndex()]); break;
  case 'index': report([writeIndex()]); break;
  case 'fonts': {
    for (const slug of ROSTER) for (const [family, axes] of loadSpec(slug).fonts) {
      const faces = await fetchFaces(family, axes);
      console.log(`${family}: ${faces.length} faces`);
    }
    break;
  }
  case 'all': report(writeRuntime().files); report(writeSkill(slugs)); break;
  default:
    console.error(`unknown mode ${mode}; use runtime, skill, pages, index, fonts or all`);
    process.exit(2);
}
