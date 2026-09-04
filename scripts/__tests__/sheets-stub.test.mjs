/**
 * THE SHEETS STUB IS A GATE FIXTURE, AND MUST STAY ONE.
 *
 * `scripts/lib/sheets-stub.mjs` answers the gate's Google Sheets URL locally so
 * a merge gate stops depending on whether Google will serve a GitHub runner
 * today (it would not, twice, on run 33874008704). That is only acceptable
 * while its blast radius is exactly one script's throwaway servers, so the
 * blast radius is asserted rather than remembered.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');
const stub = read('scripts/lib/sheets-stub.mjs');

describe('the sheets stub', () => {
  it('is loaded by the gate runner, and by nothing else in the repo', () => {
    expect(read('scripts/gates.mjs')).toContain('sheets-stub.mjs');
    const others = readdirSync(path.join(ROOT, 'scripts'))
      .filter((f) => f.endsWith('.mjs') && f !== 'gates.mjs')
      .filter((f) => read(`scripts/${f}`).includes('sheets-stub'));
    expect(others, `only scripts/gates.mjs may load the stub; found ${others.join(', ')}`).toEqual([]);
  });

  it('never reaches the image — the Dockerfiles copy no such thing', () => {
    for (const f of ['Dockerfile', 'services/app/Dockerfile'])
      expect(read(f), f).not.toContain('sheets-stub');
  });

  it('intercepts Google Sheets and delegates everything else', () => {
    expect(stub).toContain("docs.google.com/spreadsheets/");
    // The bail-out must come FIRST: a stub that answered other hosts would be
    // silently cutting the gates off from the network they are meant to use.
    const guard = stub.indexOf("if (!url.includes('docs.google.com/spreadsheets/')) return realFetch");
    const answer = stub.indexOf('new Response(');
    expect(guard, 'the delegate-everything-else guard is missing').toBeGreaterThan(-1);
    expect(guard).toBeLessThan(answer);
  });

  /**
   * The SSRF-guarded importer uses node:https, not global fetch, so patching
   * fetch cannot reach it. If web-ingest ever moves to fetch, this stub would
   * start intercepting a security-relevant path and this test says so.
   */
  it('cannot stub the SSRF-guarded web-ingest path, which uses node:https', () => {
    expect(read('services/app/lib/web-ingest/fetch.ts')).toContain("from 'node:https'");
  });

  it('serves CSV for the sheet the gate imports and HTML for any other', () => {
    expect(stub).toContain('1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms');
    expect(stub).toContain('text/csv');
    expect(stub).toContain('text/html');
  });
});
