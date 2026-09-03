import { describe, expect, it } from 'vitest';
import {
  buildMirrorFiles,
  buildPluginFiles,
  pluginChannel,
  pluginInstall,
  pluginInstallCommands,
} from '../plugin-package';

const SHA = 'a'.repeat(40);

describe('hosted plugin release channels', () => {
  it.each([
    ['production', 'artifactbin', 'https://artifactbin.dev', 'minusxai/artifactbin-plugins'],
    ['staging', 'artifactbin-oss', 'https://afx-oss.artifactbin.dev', 'minusxai/artifactbin-oss-plugins'],
  ] as const)('%s isolates plugin, skill, MCP, repository, and endpoint identity', (channel, name, base, repo) => {
    expect(pluginChannel(channel)).toMatchObject({ name, baseUrl: base, repo });
    const commands = pluginInstallCommands(channel);
    expect(commands).toEqual([
      `/plugin marketplace add ${repo}`,
      `/plugin install ${name}@${name}`,
    ]);
    expect(pluginInstall(channel)).toBe(commands.join('\n'));
    const files = buildPluginFiles(base, 'mcp', channel);
    expect(JSON.parse(files['.claude-plugin/plugin.json']!).name).toBe(name);
    expect(JSON.parse(files['.mcp.json']!).mcpServers).toEqual({
      [name]: { type: 'http', url: `${base}/mcp` },
    });
    expect(Object.keys(files)).toContain(`skills/${name}/SKILL.md`);
  });

  it('records exact source provenance in generated mirrors', () => {
    const files = buildMirrorFiles('https://afx-oss.artifactbin.dev', 'mcp', 'staging', SHA);
    expect(JSON.parse(files['.artifactbin-release.json']!)).toMatchObject({
      channel: 'staging',
      plugin: 'artifactbin-oss',
      sourceSha: SHA,
    });
    expect(files['README.md']).toContain(`minusxai/artifactbin@${SHA}`);
  });
});
