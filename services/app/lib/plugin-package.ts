/**
 * Deterministic Claude Code and Codex plugin generation from the canonical
 * skill tree. Hosted channels share content but have isolated identities.
 */
import teaching from '../../cli/src/generated/teaching.json';
import {
  PLUGIN_BASE_URL, type PluginChannel,
  pluginChannel,
  pluginInstall
} from './plugin-id';

export const PLUGIN_VERSION = teaching.version;

export {
  CODEX_APP_PLUGIN_REF,
  CODEX_APP_PLUGIN_REPO_URL,
  MARKETPLACE_NAME,
  PLUGIN_BASE_URL,
  PLUGIN_CHANNELS,
  PLUGIN_INSTALL,
  PLUGIN_NAME,
  PLUGIN_REPO,
  PLUGIN_REPO_URL,
  pluginChannel,
  pluginInstall,
  pluginInstallCommands,
} from './plugin-id';
export type { PluginChannel, PluginIdentity } from './plugin-id';

/**
 * A channel's published version never moves backwards: clients cache a plugin by
 * version, so a regression would strand them on newer teaching. Republishing the
 * same version is allowed — one CLI release can correct its own skill bundle.
 */
export function assertMonotonicVersion(previous: string | undefined, version: string = PLUGIN_VERSION): string {
  const parse = (value: string, label: string): number[] => {
    const parts = /^(\d+)\.(\d+)\.(\d+)$/.exec(value);
    if (!parts) throw new Error(`${label} plugin version ${value} is not MAJOR.MINOR.PATCH`);
    return parts.slice(1).map(Number);
  };
  if (previous === undefined) return version;
  const next = parse(version, 'next');
  const published = parse(previous, 'published');
  for (let index = 0; index < 3; index += 1) {
    if (next[index] === published[index]) continue;
    if (next[index] < published[index]) throw new Error(`plugin version ${version} is older than the published ${previous}`);
    return version;
  }
  return version;
}

const DESCRIPTION = 'Publish self-contained HTML artifacts (reports, dashboards, decks, datasets, charts, images) to artifactbin and share the public link.';
const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

function channelSkillFile(filePath: string, content: string, name: string): [string, string] {
  const canonicalPath = filePath.replace(/^artifactbin(?=\/|$)/, name);
  const canonicalContent = content.replace(/^name:\s*artifactbin\s*$/m, `name: ${name}`);
  return [canonicalPath, canonicalContent];
}

export function buildPluginFiles(
  base: string = PLUGIN_BASE_URL,
  channel: PluginChannel = 'production',
): Record<string, string> {
  const identity = pluginChannel(channel);
  const files: Record<string, string> = {
    '.claude-plugin/plugin.json': json({
      name: identity.name,
      description: DESCRIPTION,
      version: PLUGIN_VERSION,
      author: { name: 'minusx' },
      homepage: base,
    }),
    '.codex-plugin/plugin.json': json({
      name: identity.name,
      description: DESCRIPTION,
      version: PLUGIN_VERSION,
      skills: './skills/',
    }),
    'README.md': `# ${identity.name} plugin

Local CLI skills for publishing artifacts to ${base}.
This is the **${identity.channel}** release channel.

## Install (Claude Code)

\`\`\`
${pluginInstall(channel)}
\`\`\`

Local development from the artifactbin repository: \`npm run build:plugin\`,
then \`claude --plugin-dir ./plugin\`.

## What you get

- The same local skill bundle shipped with afbin ${PLUGIN_VERSION}.
- Install the CLI with \`curl -fsSL ${base}/chat/install.sh | sh\` (checksum verified), then run \`afbin setup --server ${base}\`.
- Read \`afbin help\` locally; use \`afbin push\` to publish files.

## Self-hosting

This hosted-channel plugin points at ${base}. Self-hosters should generate
their own plugin from the source repository:

\`\`\`
npm run build:plugin -- --base https://your-deployment.example
\`\`\`

This directory is generated. Do not edit it directly.
`,
  };

  for (const [file, text] of Object.entries(teaching.files)) {
    const [rel, content] = channelSkillFile('artifactbin/'+file, text, identity.name);
    files[`skills/${rel}`] = content;
  }
  return files;
}

export function buildMirrorFiles(
  base: string = PLUGIN_BASE_URL,
  channel: PluginChannel = 'production',
  sourceSha = 'development',
): Record<string, string> {
  const identity = pluginChannel(channel);
  const plugin = buildPluginFiles(base, channel);
  return {
    ...Object.fromEntries(Object.entries(plugin).map(([rel, content]) => [`plugins/${identity.name}/${rel}`, content])),
    '.artifactbin-release.json': json({
      channel: identity.channel,
      plugin: identity.name,
      baseUrl: base,
      sourceRepository: 'minusxai/artifactbin',
      sourceSha,
      version: PLUGIN_VERSION,
    }),
    '.claude-plugin/marketplace.json': json({
      name: identity.marketplace,
      description: identity.description,
      owner: { name: 'minusx' },
      plugins: [{ name: identity.name, source: `./plugins/${identity.name}`, description: DESCRIPTION }],
    }),
    'README.md': `# ${identity.name} plugins

Generated ${identity.channel} plugin release for ${base}.

\`\`\`
${pluginInstall(channel)}
\`\`\`

- **${identity.name}**: ${DESCRIPTION}
- Source: \`minusxai/artifactbin@${sourceSha}\`
- Details: [plugins/${identity.name}/README.md](plugins/${identity.name}/README.md)

Everything in this repository is generated by the artifactbin source
publication workflow. Do not edit or open pull requests here.
`,
  };
}
