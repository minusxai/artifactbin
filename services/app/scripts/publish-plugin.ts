/**
 * Publish one generated plugin channel from an exact checked-out OSS commit.
 *
 * Usage:
 *   tsx -r ../../scripts/register-yaml.cjs scripts/publish-plugin.ts \
 *     --channel <production|staging> --sha <40-char commit> [--token <token>]
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildMirrorFiles, PLUGIN_VERSION, type PluginChannel, pluginChannel } from '../lib/plugin-package';

const arg = (flag: string): string | undefined => {
  const index = process.argv.indexOf(flag);
  return index === -1 ? undefined : process.argv[index + 1];
};

const channelArg = arg('--channel');
if (channelArg !== 'production' && channelArg !== 'staging') throw new Error('--channel must be production or staging');
const channel = channelArg as PluginChannel;
const sourceSha = arg('--sha') ?? '';
if (!/^[0-9a-f]{40}$/.test(sourceSha)) throw new Error('--sha must be a full 40-character lowercase commit SHA');

const actualSha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
if (actualSha !== sourceSha) throw new Error(`checked-out source ${actualSha} does not match requested --sha ${sourceSha}`);

const identity = pluginChannel(channel);
const token = arg('--token');
const remote = token
  ? `https://x-access-token:${token}@github.com/${identity.repo}.git`
  : `https://github.com/${identity.repo}.git`;
const work = mkdtempSync(path.join(tmpdir(), `artifactbin-${channel}-plugin-`));
const git = (...args: string[]): string => execFileSync('git', ['-C', work, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

try {
  execFileSync('git', ['clone', '--branch', identity.branch, '--single-branch', remote, work], { stdio: ['ignore', 'pipe', 'pipe'] });
  for (const entry of readdirSync(work)) {
    if (entry !== '.git') rmSync(path.join(work, entry), { recursive: true, force: true });
  }
  for (const [rel, content] of Object.entries(buildMirrorFiles(identity.baseUrl, 'mcp', channel, sourceSha))) {
    const target = path.join(work, rel);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, content);
  }
  git('add', '--all');
  if (!git('status', '--porcelain')) {
    console.log(`${identity.name} already matches artifactbin@${sourceSha}`);
    process.exit(0);
  }
  git('config', 'user.name', 'artifactbin release bot');
  git('config', 'user.email', 'artifactbin-release-bot@users.noreply.github.com');
  git('commit', '-m', `Publish ${identity.name} v${PLUGIN_VERSION} from ${sourceSha}`);
  git('push', 'origin', `HEAD:${identity.branch}`);
  console.log(`Published ${identity.name} from artifactbin@${sourceSha} to ${identity.repo}`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
