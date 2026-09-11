/**
 * Marketplace identities for the generated skill mirror.
 *
 * The hosted plugin distribution channel is gone: nothing here is published,
 * installed or linked. What survives is the layout an agent harness expects
 * when it discovers skills from a marketplace directory, which `evals/` writes
 * to a temporary directory to give each harness the released skill bundle.
 */
export const PLUGIN_CHANNELS = {
  production: {
    channel: 'production',
    name: 'artifactbin',
    marketplace: 'artifactbin',
    repo: 'minusxai/artifactbin-plugins',
    baseUrl: 'https://artifactbin.dev',
    branch: 'master',
    description: 'Stable artifactbin plugin backed by the production service.',
  },
  staging: {
    channel: 'staging',
    name: 'artifactbin-oss',
    marketplace: 'artifactbin-oss',
    repo: 'minusxai/artifactbin-oss-plugins',
    baseUrl: 'https://afx-oss.artifactbin.dev',
    branch: 'master',
    description: 'Canary artifactbin plugin backed by the hosted OSS staging service.',
  },
} as const;

export type PluginChannel = keyof typeof PLUGIN_CHANNELS;
export type PluginIdentity = (typeof PLUGIN_CHANNELS)[PluginChannel];

export function pluginChannel(channel: PluginChannel): PluginIdentity {
  return PLUGIN_CHANNELS[channel];
}

export function pluginInstall(channel: PluginChannel = 'production'): string {
  return pluginInstallCommands(channel).join('\n');
}

/** Keep the two sequential Claude Code commands independently copyable while
 * preserving the joined form used in generated plugin documentation. */
export function pluginInstallCommands(
  channel: PluginChannel = 'production',
): readonly [marketplaceAdd: string, pluginInstall: string] {
  const identity = pluginChannel(channel);
  return [
    `/plugin marketplace add ${identity.repo}`,
    `/plugin install ${identity.name}@${identity.marketplace}`,
  ];
}

const production = PLUGIN_CHANNELS.production;
export const PLUGIN_NAME = production.name;
export const PLUGIN_BASE_URL = production.baseUrl;
export const MARKETPLACE_NAME = production.marketplace;
