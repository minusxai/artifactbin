/**
 * Plugin release-channel identities. Production and hosted OSS staging are
 * deliberately distinct so both can be installed in the same client.
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
  const identity = pluginChannel(channel);
  return `/plugin marketplace add ${identity.repo}\n/plugin install ${identity.name}@${identity.marketplace}`;
}

const production = PLUGIN_CHANNELS.production;
export const PLUGIN_NAME = production.name;
export const PLUGIN_REPO = production.repo;
export const PLUGIN_REPO_URL = `https://github.com/${PLUGIN_REPO}`;
export const PLUGIN_BASE_URL = production.baseUrl;
export const MARKETPLACE_NAME = production.marketplace;
export const PLUGIN_INSTALL = pluginInstall('production');
export const CODEX_APP_PLUGIN_REPO_URL = PLUGIN_REPO_URL;
export const CODEX_APP_PLUGIN_REF = production.branch;
