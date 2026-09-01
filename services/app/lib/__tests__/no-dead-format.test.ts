/**
 * There is ONE document format. `html` and `markdown` are not formats, not
 * inputs, and not wire fields: HTML is the VOCABULARY inside a markup document
 * — prose is written as ordinary tags — and markdown is not an authoring
 * language here at all.
 *
 * The same reasoning as no-dead-api-link: the retirement touched the input
 * parser, the wire echo, the MCP schema, the pages, the editor and five docs
 * sections, and a leftover in any one of them is a contract an agent will
 * believe. So the rule gets a test rather than a memory.
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
    else if (/\.tsx?$/.test(entry) && !full.includes('__tests__')) out.push(full);
  }
  return out;
}

const FILES = ['app', 'components', 'lib'].flatMap((d) => sourceFiles(path.join(ROOT, d)));
/** Where the retired keys are named on purpose, to reject them by name. */
const REJECTION_HOME = path.join(ROOT, 'lib/story/input.ts');

/** A source line that reads like a live use of a retired format. */
const OFFENDERS: Array<{ label: string; re: RegExp }> = [
  // The stored/wire vocabulary: `format: 'html'`, `format === 'html'`, "markdown" as a tier.
  { label: "format 'html'", re: /format\s*(?::|===|==|!==)\s*'html'/ },
  { label: "ArtifactFormat 'html'", re: /ArtifactFormat\s*=\s*[^;]*'html'/ },
  // The retired request/response fields.
  { label: 'html request field', re: /body\.(html|markdown)\b/ },
  // A retired tier used as a VALUE anywhere: the badge humans read on a
  // profile, the column default new rows get, the query that lists a public
  // profile. Each one shipped, and each one showed `html` to somebody after
  // the tier was deleted.
  { label: "'html' as a fallback format", re: /format\s*\?\?\s*'html'/ },
  { label: "'html' as a column default", re: /default:\s*"'html'"/ },
  { label: "'html' in a format IN\\(…\\) clause", re: /format IN \([^)]*'html'/ },
  { label: 'a FormatBadge for a retired tier', re: /FormatBadge format="(html|markdown)"/ },
  // The wire must not carry a retired tier's NAME either: version reads echoed
  // `html: row.content` long after nothing stored html — and for a dataset or
  // a recipe that content was never html to begin with.
  { label: "'html' as a wire field", re: /\bhtml:\s*(row|artifact)\.content/ },
  { label: 'html wire echo', re: /^\s*html:\s*(content|row\.content|artifact\.content)/ },
  // A bare object KEY: the format→color map in components/ui.tsx carried
  // `html: '#3498db'` past the retirement, and no pattern above saw it. The
  // rejection-hint map (REJECTION_HOME) keys BY the retired names on purpose —
  // that is how an agent sending the old shape learns what replaced it.
  { label: 'a retired tier as an object key', re: /^\s*(html|markdown):\s*['"]/ },
];

describe('one document format', () => {
  it('no source file treats html or markdown as a format', () => {
    const hits: string[] = [];
    for (const file of FILES) {
      if (file === REJECTION_HOME) continue; // it names them to reject them
      const lines = readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, i) => {
        // Comments explain the retirement; they are not uses of it. (Block
        // comments continue with a leading `*`, which is prose too.)
        if (/^\s*[*]/.test(line)) return;
        const code = line.replace(/\/\/.*$/, '').replace(/\/\*.*?\*\//g, '');
        for (const { label, re } of OFFENDERS) {
          if (re.test(code)) hits.push(`${path.relative(ROOT, file)}:${i + 1} — ${label}: ${line.trim()}`);
        }
      });
    }
    expect(hits).toEqual([]);
  });

  it('is actually looking at something (the scan cannot silently find nothing)', () => {
    // The walk is the whole guard: no files, no hits, green forever.
    expect(FILES.length).toBeGreaterThan(50);
    expect(FILES.some((f) => f.endsWith(path.join('lib', 'story', 'input.ts')))).toBe(true);
  });

  it('the format vocabulary itself lists exactly the surviving values', async () => {
    // The VALUE, not a regex over the declaration: the runtime list and the
    // type are one declaration now (readers ask it "do we serve this?"), so
    // asserting the list is asserting both.
    const { ARTIFACT_FORMATS } = await import('@/lib/story/input');
    expect([...ARTIFACT_FORMATS].sort()).toEqual(['dataset', 'image', 'markup', 'viz']);
  });

  it('the agent doc teaches markup only', () => {
    const doc = readFileSync(path.join(ROOT, 'skills/artifactbin/references/publishing.md'), 'utf8');
    expect(doc).toContain('markup | dataset | viz | image');
    expect(doc).not.toContain('markup | markdown | html');
  });
});
