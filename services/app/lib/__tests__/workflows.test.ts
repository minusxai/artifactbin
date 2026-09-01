/**
 * THE PUBLISH AND CI WORKFLOWS, as source text — all four consumed images, the lean
 * pass, and the compose job.
 *
 * The published images exist to be PULLED by a deployment: app, SQL, and
 * browser by the proprietary split shape, and the full one by a self-host
 * that wants one container. The OSS proxy remains built and exercised in CI,
 * but is not published because no deployment pulls it. A publish.yml that
 * stops building any consumed image is
 * a silent drift: the app image moves on, the service images rot at an old
 * commit, and a deployment composes halves that were never shipped together.
 * Pinned here, structurally (parsed YAML, not regex): every job exists, each
 * names ITS Dockerfile (not the root one — that is the full image), builds
 * from the REPO ROOT context (the Dockerfiles COPY `services/` from it), for
 * the staging box's arch, and is tagged like every other image this repo
 * publishes.
 *
 * The CI side of the same contract: the `image` job builds the FULL image and
 * runs the four lean ones through `image-checks.mjs` (contents + boot + size
 * — a runtime dep that sneaks into a lean closure fails THERE, not at 3am on
 * a box), and the `compose` job boots `docker-compose.lean.yml` and walks it
 * (`test-compose-lean.mjs`) — the split shape the plan's P5 deploys, proven
 * on every PR rather than discovered at the cutover.
 */
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import yaml from 'yaml';
import { describe, expect, it } from 'vitest';

const root = path.join(__dirname, '../../../..');
const publishPath = path.join(root, '.github', 'workflows', 'publish.yml');
const ciPath = path.join(root, '.github', 'workflows', 'ci.yml');
const wf = yaml.parse(readFileSync(publishPath, 'utf8')) as {
  jobs: Record<string, {
    steps: Array<{ uses?: string; with?: Record<string, unknown> }>;
  }>;
};
const ci = yaml.parse(readFileSync(ciPath, 'utf8')) as {
  jobs: Record<string, {
    'timeout-minutes'?: number;
    env?: Record<string, string>;
    steps: Array<{ uses?: string; with?: Record<string, unknown>; run?: string; name?: string; env?: Record<string, string> }>;
  }>;
};

const buildPush = (job: string) => wf.jobs[job]?.steps.find((s) => s.uses?.startsWith('docker/build-push-action'));
const metadata = (job: string) => wf.jobs[job]?.steps.find((s) => s.uses?.startsWith('docker/metadata-action'));

/** The four images a deployment pulls, and the Dockerfile each is built from. */
const PUBLISHED_IMAGES: Array<{ suffix: string; file: string }> = [
  { suffix: '', file: 'Dockerfile' },
  { suffix: '-app', file: 'services/app/Dockerfile' },
  { suffix: '-sql', file: 'services/sql/Dockerfile' },
  { suffix: '-browser', file: 'services/browser/Dockerfile' },
];

describe.each(PUBLISHED_IMAGES)('publish.yml: the %s image', ({ suffix, file }) => {
  const job = suffix ? `publish${suffix}` : 'publish';
  it(`has a ${job} job that builds and pushes ghcr.io/<owner>/artifactbin${suffix}`, () => {
    expect(wf.jobs[job], `publish.yml has no ${job} job`).toBeDefined();
    const images = metadata(job)?.with?.images;
    expect(String(images)).toContain(`artifactbin${suffix}`);
  });
  it(`builds from ${file} with the REPO ROOT as context, for linux/amd64, and pushes`, () => {
    const with_ = buildPush(job)?.with ?? {};
    expect(with_.file).toBe(file);
    expect(with_.context).toBe('.');
    expect(with_.platforms).toBe('linux/amd64');
    expect(with_.push).toBe(true);
  });
  it('is tagged like every other image this repo publishes (sha + latest)', () => {
    const tags = String(metadata(job)?.with?.tags ?? '');
    expect(tags).toContain('type=sha,prefix=');
    expect(tags).toContain('type=raw,value=latest');
  });
});

describe('publish.yml: the image set as a whole', () => {
  it('publishes exactly the four consumed images, no more and no fewer', () => {
    const allImages = Object.keys(wf.jobs)
      .flatMap((j) => wf.jobs[j].steps)
      .filter((s) => s.uses?.startsWith('docker/metadata-action'))
      .map((s) => String(s.with?.images));
    for (const { suffix } of PUBLISHED_IMAGES) {
      // The image name rides a `${{ github.repository_owner }}` prefix in the
      // YAML, so match on the suffix the deployment pulls.
      expect(allImages.some((i) => i.includes(`artifactbin${suffix}`)), `artifactbin${suffix} gone from publish.yml`).toBe(true);
    }
    expect(allImages).toHaveLength(4);
    expect(wf.jobs['publish-proxy']).toBeUndefined();
    expect(allImages.some((i) => i.includes('artifactbin-proxy'))).toBe(false);
  });
  it('carries no stale multi-target vocabulary (app-lean / target:)', () => {
    const publish = readFileSync(publishPath, 'utf8');
    for (const stale of ['app-lean', 'target:']) {
      expect(publish, `publish.yml still says "${stale}"`).not.toContain(stale);
    }
  });
  it('the root Dockerfile carries no stale multi-target vocabulary either', () => {
    const dockerfile = readFileSync(path.join(root, 'Dockerfile'), 'utf8');
    for (const stale of ['app-lean', 'target:']) {
      expect(dockerfile, `the root Dockerfile still says "${stale}"`).not.toContain(stale);
    }
  });
  it('dispatches the exact commit only after every public image is published', () => {
    const publish = readFileSync(publishPath, 'utf8');
    expect(publish).toContain('needs: [publish, publish-app, publish-sql, publish-browser]');
    expect(publish).toContain('gh workflow run artifactbin-staging-deploy.yaml');
    expect(publish).toContain('-f oss_sha="${GITHUB_SHA}"');
  });
});

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
    for (const file of ['ci.yml', 'publish.yml', 'publish-plugin.yml']) {
      const text = readFileSync(path.join(root, '.github/workflows', file), 'utf8');
      const refs = [...text.matchAll(/uses:\s+([^\s#]+)\s*(?:#.*)?$/gm)].map((m) => m[1]);
      expect(refs.length, file).toBeGreaterThan(0);
      for (const ref of refs) expect(ref, `${file}: ${ref}`).toMatch(/@[0-9a-f]{40}$/);
    }
  });
});

describe('development dependency security', () => {
  it('pins Monaco to the latest release outside the vulnerable DOMPurify advisory range', () => {
    for (const file of ['package.json', 'services/app/package.json']) {
      const pkg = JSON.parse(readFileSync(path.join(root, file), 'utf8')) as { devDependencies?: Record<string, string> };
      expect(pkg.devDependencies?.['monaco-editor'], file).toBe('0.53.0');
    }
  });
});

describe('ci.yml: the image job proves what ships', () => {
  const steps = ci.jobs.image?.steps ?? [];
  const runs = steps.map((s) => String(s.run ?? ''));
  it('boots the FULL image built from the root Dockerfile', () => {
    const fullBuild = steps.find((s) => s.uses?.startsWith('docker/build-push-action'));
    expect(fullBuild?.with?.file).toBe('Dockerfile');
    expect(fullBuild?.with?.context).toBe('.');
  });
  it('runs the LEAN pass: all four lean images through image-checks.mjs', () => {
    expect(runs.some((r) => r.includes('services/app/Dockerfile')), 'no lean app build').toBe(true);
    expect(runs.some((r) => r.includes('services/proxy/Dockerfile')), 'no lean proxy build').toBe(true);
    expect(runs.some((r) => r.includes('services/sql/Dockerfile')), 'no lean sql build').toBe(true);
    expect(runs.some((r) => r.includes('services/browser/Dockerfile')), 'no lean browser build').toBe(true);
    for (const kind of ['app', 'proxy', 'sql', 'browser']) {
      expect(runs.some((r) => r.includes(`image-checks.mjs ${kind}`)), `image-checks never checks the ${kind} image`).toBe(true);
    }
  });
});

describe('ci.yml: the compose job walks the split shape', () => {
  it('exists, boots docker-compose.lean.yml and runs test-compose-lean.mjs', () => {
    const job = ci.jobs.compose;
    expect(job, 'ci.yml has no compose job').toBeDefined();
    const runs = (job?.steps ?? []).map((s) => String(s.run ?? ''));
    expect(runs.some((r) => r.includes('docker-compose.lean.yml')), 'the compose job never boots docker-compose.lean.yml').toBe(true);
    expect(runs.some((r) => r.includes('test-compose-lean.mjs')), 'the compose job never runs the walk').toBe(true);
  });
  it('is given the ~30 minutes the plan budgets for it', () => {
    expect(Number(ci.jobs.compose?.['timeout-minutes'] ?? 0)).toBeGreaterThanOrEqual(30);
  });
  it('provides every secret required by the hardened lean composition', () => {
    const env = ci.jobs.compose?.env;
    for (const name of ['AUTH__SECRET', 'CONTRACT__ACTOR_SECRET', 'INTERNAL__SERVICE_SECRET', 'POSTGRES_PASSWORD']) {
      expect(env?.[name], `compose boot is missing ${name}`).toBeTruthy();
    }
  });
});

describe('every lean Dockerfile installs only its own package', () => {
  // A Dockerfile whose runtime install reaches outside its package is the
  // maze coming back: the whole point of the lean images is that npm's own
  // workspace resolution — `-w services/<its own package>` — decides the
  // closure, never a hand-written list.
  it.each([
    ['app', 'services/app/Dockerfile'],
    ['proxy', 'services/proxy/Dockerfile'],
    ['sql', 'services/sql/Dockerfile'],
    ['browser', 'services/browser/Dockerfile'],
  ])('%s installs with -w services/%s', (_name, file) => {
    const text = readFileSync(path.join(root, file), 'utf8');
    expect(text).toContain(`-w services/${_name}`);
  });
});
