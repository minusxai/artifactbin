/**
 * Publishes the generated plugin to the public mirror repo (PLUGIN_REPO):
 * clone → replace the whole tree with buildMirrorFiles() → commit + push if
 * anything changed. The mirror is pure build output — no hand-edits, no
 * merges, history is append-only from here.
 *
 * Usage: tsx -r ./scripts/register-yaml.cjs scripts/publish-plugin.ts \
 *          [--base <url>] [--repo <owner/name>] [--token <push token>]
 * Without --token, git's ambient credentials are used (gh auth locally,
 * a configured deploy credential in CI).
 */
import { execFileSync } from 'child_process';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { buildMirrorFiles, PLUGIN_BASE_URL, PLUGIN_REPO, PLUGIN_VERSION } from '../lib/plugin-package';

const arg = (flag: string): string | undefined => {
  const i = process.argv.indexOf(flag);
  return i !== -1 ? process.argv[i + 1] : undefined;
};

const base = arg('--base') ?? PLUGIN_BASE_URL;
const repo = arg('--repo') ?? PLUGIN_REPO;
const token = arg('--token');
if (!/^https?:\/\//.test(base)) throw new Error(`--base must be an http(s) URL, got: ${base}`);
// --repo takes owner/name (GitHub) or a full git remote (testing, self-hosting).
const isSlug = /^[\w.-]+\/[\w.-]+$/.test(repo);
const remote = isSlug
  ? (token ? `https://x-access-token:${token}@github.com/${repo}.git` : `https://github.com/${repo}.git`)
  : repo;
const work = mkdtempSync(path.join(tmpdir(), 'plugin-mirror-'));
const git = (...args: string[]) => execFileSync('git', ['-C', work, ...args], { stdio: ['ignore', 'pipe', 'inherit'] }).toString().trim();

try {
  execFileSync('git', ['clone', '--depth=1', remote, work], { stdio: ['ignore', 'pipe', 'inherit'] });

  // Full replace: everything except .git goes, then the generated tree lands.
  for (const entry of readdirSync(work)) {
    if (entry !== '.git') rmSync(path.join(work, entry), { recursive: true, force: true });
  }
  const files = buildMirrorFiles(base);
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(work, rel);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, content);
  }

  git('add', '--all');
  if (git('status', '--porcelain') === '') {
    console.log(`mirror ${repo} already up to date (v${PLUGIN_VERSION}, ${base})`);
  } else {
    git('-c', 'user.name=artifact-bin publish', '-c', 'user.email=noreply@minusx.ai', 'commit', '-m', `publish v${PLUGIN_VERSION} for ${base}`);
    git('push', 'origin', 'HEAD');
    console.log(`published v${PLUGIN_VERSION} (${Object.keys(files).length} files) to ${repo} for ${base}`);
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}
