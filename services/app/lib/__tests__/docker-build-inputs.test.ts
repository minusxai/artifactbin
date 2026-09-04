/**
 * Everything `npm run build` reads must be COPIED into the image.
 *
 * The Dockerfile copies a curated list, not the repo, and `npm run build`
 * grew a first step when the story runtime became a build artifact:
 * `node scripts/build-story-runtime.mjs && next build`. The image copied only
 * `scripts/copy-assets.mjs`, so the merge to master failed at
 * `Cannot find module '/app/scripts/build-story-runtime.mjs'` — after CI was
 * fully green, because CI's `next build` runs on a whole checkout and the
 * image does not.
 *
 * So the rule is checked rather than remembered: any `scripts/…` file the
 * build script names has to be reachable in the builder stage.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '../..');
const dockerfile = readFileSync(path.join(ROOT, 'Dockerfile'), 'utf8');
const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as {
  scripts: Record<string, string>;
};

/** The scripts/ files the image's build command runs, transitively through npm. */
function scriptsNeededByBuild(): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const walk = (name: string) => {
    if (seen.has(name)) return;
    seen.add(name);
    const body = pkg.scripts[name];
    if (!body) return;
    for (const m of body.matchAll(/scripts\/[\w.-]+\.(?:mjs|cjs|js|ts)/g)) out.push(m[0]);
    // npm runs pre<name>/post<name> around it, and `npm run x` chains
    for (const m of body.matchAll(/npm run ([\w:-]+)/g)) walk(m[1]);
    walk(`pre${name}`);
    walk(`post${name}`);
  };
  walk('build');
  return [...new Set(out)];
}

/** Paths the builder stage makes available before `npm run build` runs. */
const copiedInBuilder = (p: string): boolean => {
  const dir = p.split('/')[0]; // e.g. "scripts"
  return (
    dockerfile.includes('COPY services ./services') ||
    dockerfile.includes(`COPY ${p} `) ||
    new RegExp(`^COPY ${dir} `, 'm').test(dockerfile) ||
    new RegExp(`^COPY ${dir}/ `, 'm').test(dockerfile)
  );
};

describe('the image can run npm run build', () => {
  it('finds at least the runtime build step (the scan is not vacuous)', () => {
    expect(scriptsNeededByBuild()).toContain('scripts/build-story-runtime.mjs');
  });

  it.each(scriptsNeededByBuild())('copies %s into the builder stage', (p) => {
    expect(copiedInBuilder(p), `Dockerfile never copies ${p}, so the image build cannot run it`).toBe(true);
  });

  it('also copies whatever postinstall needs, before npm ci', () => {
    // `npm ci` triggers postinstall (copy-assets), so its script must land first.
    //
    // This used to be satisfied by `COPY services ./services` sitting above the
    // install, which copied the whole repo to get one file — and made every
    // source edit rebuild the install and re-upload its ~518 MB layer
    // (docker-install-layer.test.ts). The tree now lands AFTER the install, so
    // the postinstall script is named on its own. Its requirement really is
    // just the file: it chdirs to its own package dir and reads node_modules.
    const scriptRunningInstall = dockerfile
      .split(/^FROM /m)
      .map((stage) => stage.split('\n'))
      .find((lines) => lines.some((l) => /^RUN /.test(l) && /npm ci/.test(l) && !l.includes('--ignore-scripts')));
    expect(scriptRunningInstall, 'no stage runs npm ci with its lifecycle scripts').toBeDefined();
    const before = (scriptRunningInstall ?? []).slice(
      0,
      (scriptRunningInstall ?? []).findIndex((l) => /^RUN /.test(l) && /npm ci/.test(l)),
    );
    expect(before.join('\n'), 'the postinstall script must reach the image before the install that runs it').toContain(
      'services/app/scripts/copy-assets.mjs',
    );
  });
});
