/** CI image/compose contracts and immutable maintenance action pins. */
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import yaml from 'yaml';
import { describe, expect, it } from 'vitest';

const root = path.resolve(import.meta.dirname, '../..');
const ciPath = path.join(root, '.github', 'workflows', 'ci.yml');
const ci = yaml.parse(readFileSync(ciPath, 'utf8'));

describe('the public repository boundary', () => {
  it('contains no proprietary deployment identifiers in any tracked source file', () => {
    const files = execFileSync('git', ['ls-files', '-z'], { cwd: root }).toString().split('\0').filter(Boolean);
    const markers = [['artifactbin', 'prod'].join('-'), ['afbin', 'prod'].join('_')];
    const leaks = files.flatMap((file) => {
      const full = path.join(root, file);
      let text = ''; try { text = readFileSync(full, 'utf8'); } catch { return []; }
      return markers.filter((marker) => text.includes(marker)).map((marker) => `${file}: ${marker}`);
    });
    expect(leaks).toEqual([]);
  });
});

describe('workflow supply-chain pins', () => {
  it('uses immutable full commit SHAs for every third-party action', () => {
    for (const file of ['ci.yml', 'cli-runtime.yml', 'publish-cli.yml', 'release-cli.yml']) {
      const text = readFileSync(path.join(root, '.github/workflows', file), 'utf8');
      const refs = [...text.matchAll(/uses:\s+([^\s#]+)\s*(?:#.*)?$/gm)].map((m) => m[1]);
      if (file !== 'release-cli.yml') expect(refs.length, file).toBeGreaterThan(0);
      for (const ref of refs) expect(ref, `${file}: ${ref}`).toMatch(/@[0-9a-f]{40}$/);
    }
  });
});

describe('dependency security', () => {
  // SourceEditor bundles the pinned editor and worker at build time. The
  // browser loads those local assets; the Node image needs no second copy.
  it('pins Monaco — the copy that SHIPS — outside the vulnerable DOMPurify advisory range', () => {
    // ONE HOME per shared devDependency: the app bundles the editor, so the app package declares
    // the pin and the root declares nothing. The assertion used to demand the pin in BOTH files
    // and went red the moment the root's copy was removed — a version that exists in one place
    // cannot also be asserted in two.
    const read = (file) => JSON.parse(readFileSync(path.join(root, file), 'utf8'));
    expect(read('services/app/package.json').devDependencies?.['monaco-editor']).toBe('0.53.0');
    expect(read('package.json').devDependencies?.['monaco-editor'], 'the root must not keep a second copy').toBeUndefined();
    // Never a runtime dependency anywhere: it is a build input, not something the server loads.
    for (const file of ['package.json', 'services/app/package.json']) {
      expect(read(file).dependencies?.['monaco-editor'], file).toBeUndefined();
    }
  });
});

describe('ci.yml: the image job proves what ships', () => {
  const steps = ci.jobs.image?.steps ?? [];
  it('boots the FULL image built from the root Dockerfile', () => {
    const fullBuild = steps.find((s) => s.uses?.startsWith('docker/build-push-action'));
    expect(fullBuild?.with?.file).toBe('Dockerfile');
    expect(fullBuild?.with?.context).toBe('.');
  });
});

describe('OSS single-host image ownership', () => {
  it('keeps the real full-image check and leaves split deployment CI to production', () => {
    expect(ci.jobs.image).toBeDefined();
    expect(ci.jobs.gates).toBeDefined();
    expect(ci.jobs).not.toHaveProperty('compose');
    expect(ci.jobs.plan.outputs).not.toHaveProperty('compose');
    expect(ci.jobs.test.needs).toContain('image');
    expect(ci.jobs.test.needs).not.toContain('compose');
  });
});

describe('source host compatibility matrix', () => {
  it('runs source, installed package and standalone CLI against the ID-first host', () => {
    const steps = ci.jobs['reference-compatibility'].steps;
    const candidate = steps.find(step => step.name === 'ID-first conformance for bundle, installed package and executable');
    expect(candidate?.['working-directory']).toBe('candidate');
    expect(candidate?.run).toContain('afbin-consumer/node_modules/@artifactbin/cli/dist/afbin.mjs');
    expect(candidate?.run).toContain('services/cli/dist/afbin.mjs');
    expect(candidate?.run).toContain('scripts/gates.mjs --servers=1 --only=cli-conformance');
    expect(readFileSync(ciPath, 'utf8')).not.toContain('build-public-packages.mjs');
  });
});
