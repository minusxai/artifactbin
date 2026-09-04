/**
 * THE INSTALL LAYER IS KEYED ON MANIFESTS, NEVER ON THE SOURCE TREE.
 *
 * `npm ci` reads exactly two things: the root `package*.json` and each
 * workspace's `package.json`. Docker cannot know that — it invalidates a layer
 * when ANYTHING copied before it changes — so a `COPY services ./services`
 * sitting above the install makes every source edit rebuild the install.
 *
 * Measured on the `image` job, run 33864009513: the base image and the root
 * manifest copy were CACHED, then `COPY services ./services` landed and both
 * installs rebuilt. That cost the build 51s it did not need to spend, and cost
 * far more downstream — the runtime stage's ~518 MB layer was NEW on every
 * run, so buildx re-uploaded it to the GitHub Actions cache every time (63.7s),
 * and the repo's shared 10 GB cache budget held five copies of one blob,
 * evicting the entries the next run wanted to restore.
 *
 * So the order is: manifests, then install, then the tree. `COPY services
 * ./services` still happens — the image's contents are unchanged, only the
 * layer boundary moves — it just happens AFTER.
 *
 * The one thing that must ride above the install with the manifests is the
 * app's postinstall script: `npm ci` runs it, it chdirs to its own package dir
 * and reads only `node_modules`, so the script file itself is its whole
 * requirement. That rule has its own assertion in docker-build-inputs.test.ts,
 * which is where the incident that taught it is written down.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(import.meta.dirname, '../../../..');

/** Every Dockerfile in the repo, DISCOVERED — a new service image joins by existing. */
function dockerfiles(): string[] {
  const found: string[] = [];
  if (existsSync(path.join(ROOT, 'Dockerfile'))) found.push('Dockerfile');
  for (const entry of readdirSync(path.join(ROOT, 'services'), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const rel = path.join('services', entry.name, 'Dockerfile');
    if (existsSync(path.join(ROOT, rel))) found.push(rel);
  }
  return found;
}

/** The workspace manifests `npm ci` reads, from package.json's own globs. */
const WORKSPACES: string[] = (
  JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as { workspaces: string[] }
).workspaces;

/**
 * Each `npm ci` in a Dockerfile, with the COPY lines that precede it IN ITS OWN
 * STAGE — a `FROM` resets what the filesystem holds, so a copy in the builder
 * says nothing about the runtime stage.
 */
function installsWithPrecedingCopies(rel: string): { line: number; copies: string[] }[] {
  const out: { line: number; copies: string[] }[] = [];
  let copies: string[] = [];
  readFileSync(path.join(ROOT, rel), 'utf8').split('\n').forEach((text, i) => {
    if (/^FROM /.test(text)) copies = [];
    else if (/^COPY /.test(text)) copies.push(text);
    else if (/^RUN /.test(text) && /(^|\s)npm ci(\s|$)/.test(text)) out.push({ line: i + 1, copies: [...copies] });
  });
  return out;
}

describe('every install layer', () => {
  const files = dockerfiles();
  const all = files.flatMap((rel) => installsWithPrecedingCopies(rel).map((i) => ({ rel, ...i })));

  it('finds the installs to judge (the scan is not vacuous)', () => {
    expect(files.length).toBeGreaterThanOrEqual(5);
    expect(all.length).toBeGreaterThanOrEqual(9);
    expect(WORKSPACES.length).toBeGreaterThanOrEqual(6);
  });

  it.each(all.map((i) => [`${i.rel}:${i.line}`, i] as const))(
    '%s is not preceded by the whole source tree',
    (_name, install) => {
      for (const copy of install.copies)
        expect(
          copy,
          `${_name}: this COPY sits above the install, so every source edit rebuilds it and re-uploads its layer`,
        ).not.toMatch(/^COPY services \.\/services\s*$/);
    },
  );

  it.each(all.map((i) => [`${i.rel}:${i.line}`, i] as const))(
    '%s gets every workspace manifest first',
    (_name, install) => {
      const copied = install.copies.join('\n');
      expect(copied, `${_name}: the root manifests are what npm ci reads first`).toMatch(/^COPY package/m);
      for (const ws of WORKSPACES)
        expect(copied, `${_name}: npm ci reads ${ws}/package.json and cannot resolve the workspace without it`).toContain(
          `${ws}/package.json`,
        );
    },
  );
});
