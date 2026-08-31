/**
 * The plugin generator (lib/plugin-package.ts). Nothing generated is committed
 * in THIS repo: `npm run build:plugin` writes plugin/ (gitignored) for local
 * `claude --plugin-dir ./plugin` testing, and `scripts/publish-plugin.ts`
 * pushes the mirror tree to the public plugin repo.
 *
 * The plugin's `skills/` IS the repo's `skills/` tree rendered with the
 * production base — so an agent holding the plugin and an agent fetching
 * `/docs` read the same words, and the two cannot drift.
 */
import { describe, expect, it } from 'vitest';
import { buildMirrorFiles, buildPluginFiles, MARKETPLACE_NAME, PLUGIN_BASE_URL, PLUGIN_NAME, PLUGIN_REPO } from '../plugin-package';
import { renderTree, skillFileWithFrontmatter, skillTree } from '../skills';
import { STORY_THEMES } from '../data/story/story-themes';
import { STORY_TEMPLATES } from '../data/story/story-templates';

const BASE = 'https://example.test';

describe('buildPluginFiles', () => {
  const files = buildPluginFiles();

  it('produces both manifests, the MCP config, README, and ONE skill with its SKILL.md over references/', () => {
    const paths = Object.keys(files);
    expect(paths).toContain('.claude-plugin/plugin.json');
    expect(paths).toContain('.codex-plugin/plugin.json');
    expect(paths).toContain('.mcp.json');
    expect(paths).toContain('README.md');
    expect(paths).toContain('skills/artifact-bin/SKILL.md');
    // ONE preloaded skill: every other skills/ path is a reference inside it.
    expect(paths.filter((p) => p.startsWith('skills/') && p !== 'skills/artifact-bin/SKILL.md')
      .every((p) => p.startsWith('skills/artifact-bin/references/'))).toBe(true);
    // No loose file at the skills root: every loader treats a SUBDIRECTORY as a skill.
    expect(paths.filter((p) => /^skills\/[^/]+$/.test(p))).toEqual([]);
  });

  it('ships the whole tree, byte-for-byte the served docs rendered with the production base', () => {
    // The plugin ships the `mcp` transport rendering: its reader has the tools
    // registered, so its brief opens with a tool call where /docs teaches curl.
    for (const { file, text } of renderTree(skillTree(), PLUGIN_BASE_URL, 'mcp')) {
      expect(files[`skills/${file.path}`]).toBe(skillFileWithFrontmatter(file, text));
    }
    for (const t of STORY_THEMES) expect(files[`skills/artifact-bin/references/themes-${t.name}.md`]).toBeTruthy();
    for (const t of STORY_TEMPLATES) expect(files[`skills/artifact-bin/references/templates-${t.name}.md`]).toBeTruthy();
    expect(Object.keys(files).filter((p) => p.startsWith('skills/'))).toHaveLength(skillTree().files.length);
  });

  it('writes valid manifests naming the plugin consistently', () => {
    const claude = JSON.parse(files['.claude-plugin/plugin.json']);
    expect(claude.name).toBe(PLUGIN_NAME);
    expect(claude.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(claude.description).toBeTruthy();
    const codex = JSON.parse(files['.codex-plugin/plugin.json']);
    expect(codex.name).toBe(PLUGIN_NAME);
    expect(codex.version).toBe(claude.version);
  });

  it('registers the streamable-HTTP MCP server at <base>/mcp', () => {
    const mcp = JSON.parse(files['.mcp.json']);
    const server = mcp.mcpServers[PLUGIN_NAME];
    expect(server.type).toBe('http');
    expect(server.url).toBe(`${PLUGIN_BASE_URL}/mcp`);
  });

  it('gives every skill file parseable frontmatter with a trigger description', () => {
    for (const [p, text] of Object.entries(files)) {
      if (!p.startsWith('skills/')) continue;
      expect(text.startsWith('---\nname: '), p).toBe(true);
      // Quoted scalar — descriptions contain colons, which break bare YAML values.
      expect(text, p).toMatch(/^description: ".+"$/m);
      expect(text, p).toContain('## Read first');
    }
  });

  it('honors a base override in every generated URL', () => {
    const other = buildPluginFiles('https://self.example.org');
    expect(other['.mcp.json']).toContain('https://self.example.org/mcp');
    for (const [p, text] of Object.entries(other)) expect(text, p).not.toContain(PLUGIN_BASE_URL);
    // The mcp rendering publishes by tool call, so the base rides the
    // deliverable URL rather than an /api address.
    expect(other['skills/artifact-bin/SKILL.md']).toContain('https://self.example.org/a/');
  });
});

describe('buildMirrorFiles (the minusx org marketplace)', () => {
  const mirror = buildMirrorFiles();

  it('nests every plugin file under plugins/<name>/ and adds the marketplace + a repo README', () => {
    const pluginFiles = buildPluginFiles();
    for (const rel of Object.keys(pluginFiles)) {
      expect(mirror[`plugins/${PLUGIN_NAME}/${rel}`]).toBe(pluginFiles[rel]);
    }
    expect(Object.keys(mirror).sort()).toEqual(
      ['README.md', '.claude-plugin/marketplace.json', ...Object.keys(pluginFiles).map((p) => `plugins/${PLUGIN_NAME}/${p}`)].sort(),
    );
  });

  it('is named for the org (the install suffix), listing the plugin from its subdirectory', () => {
    const m = JSON.parse(mirror['.claude-plugin/marketplace.json']);
    expect(m.name).toBe(MARKETPLACE_NAME);
    expect(m.description).toBeTruthy();
    expect(m.plugins).toHaveLength(1);
    expect(m.plugins[0]).toMatchObject({ name: PLUGIN_NAME, source: `./plugins/${PLUGIN_NAME}` });
  });

  it('tells installers to add the org marketplace and install <plugin>@<marketplace>', () => {
    for (const readme of [mirror['README.md'], mirror[`plugins/${PLUGIN_NAME}/README.md`]]) {
      expect(readme).toContain(`/plugin marketplace add ${PLUGIN_REPO}`);
      expect(readme).toContain(`/plugin install ${PLUGIN_NAME}@${MARKETPLACE_NAME}`);
    }
  });
});

/**
 * MEASURED, on the production matrix: with the harness configuration held
 * constant and ZERO documentation fetched, plugins mode still cost 2.2× the
 * paste flow. The reason was size: the publish skill embedded the whole
 * 30 KB protocol doc, and a skill a harness has opened stays in context for
 * every remaining turn. So the always-read skill is the SAME brief the paste
 * flow uses (capped, lib/skills), and everything else is a sibling file a
 * harness opens only when the brief says to.
 */
describe('the root skill is a briefing, not the whole manual', () => {
  const files = buildPluginFiles(BASE);
  const brief = files['skills/artifact-bin/SKILL.md'];

  it('is under the always-read cap, and every other file is too', () => {
    expect(Buffer.byteLength(brief)).toBeLessThan(8_700); // 8,192 + frontmatter
    for (const [p, text] of Object.entries(files)) if (p.startsWith('skills/')) expect(Buffer.byteLength(text), p).toBeLessThan(8_700);
  });

  it('still carries what a straightforward document cannot be written without', () => {
    // The plugin's reader has the MCP tools registered: auth is the
    // connection's (no bearer to manage) and the publish example is the TOOL
    // CALL, not a curl of the HTTP address.
    expect(brief).toMatch(/already authenticated/i);
    expect(brief).toContain('create_artifact({');
    expect(brief).toContain('className');
    expect(brief).toMatch(/self-contained|no CDN/i);
  });

  /**
   * Data is where the brief deliberately stops and points; what matters is
   * that the pointer is here, so the stop is a door rather than a wall.
   */
  it('sends a data document to the reference instead of inlining it', () => {
    expect(brief).toMatch(/dataset/i);
    // The pointer is the LOCAL file beside this skill — a plugin agent must
    // never be sent over HTTP for a file it already holds on disk.
    expect(brief).toContain('`markup-data.md`');
    expect(brief).toContain('references/');
    expect(brief).not.toContain(`${BASE}/docs/artifact-bin/references/`);
    expect(brief).not.toContain('download=true');
  });

  /**
   * The plugin has no start document: an agent holding it CREATES one. The
   * brief a start link serves teaches `PUT /api/artifacts/<id>` because there
   * a document already exists — teaching that here would send every plugin
   * user to replace an artifact it does not have.
   */
  it('teaches the create call, not the replace call', () => {
    expect(brief).toContain('create_artifact({');
    expect(brief).not.toContain('update_artifact({ "id"');
    expect(brief).not.toMatch(/curl -X (POST|PUT)/);
  });
});
