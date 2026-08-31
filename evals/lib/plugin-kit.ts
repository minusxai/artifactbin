/**
 * The plugin the agent is given when the skill source is `installed` — materialized for the
 * base URL the agent will actually see.
 *
 * There is no second copy of the vocabulary here: `lib/plugin-package.ts` is
 * the ONE generator, the same one `Publish Plugin` ships to the public
 * marketplace, built from the same `buildSkillDoc`/`buildMarkupDoc` that serve
 * `/docs/*`. A skill that drifted from the doc would make a plugin run measure
 * a document nobody else is reading.
 *
 * The MIRROR layout (a marketplace holding one plugin) is what gets written,
 * not the bare plugin: Codex refuses a plugin directory as a marketplace root
 * ("does not contain a supported manifest") and installs only from one, while
 * the other three harnesses want the plugin subdirectory. One materialization
 * serves both — the plugin is simply a path inside the marketplace.
 *
 * The base URL is per TASK, not per leg: locally each task gets its own
 * recording proxy on its own port, and a skill teaching the wrong port sends
 * that task's traffic past its own ledger.
 */
import fs from 'node:fs';
import path from 'node:path';
import { buildMirrorFiles } from '@/lib/plugin-package';
import { MARKETPLACE_NAME, PLUGIN_NAME } from '@/lib/plugin-id';

export interface PluginKit {
  /** The marketplace root — what Codex adds. */
  marketplaceDir: string;
  /** The plugin inside it — what `--plugin-dir` and `--skill` point at. */
  pluginDir: string;
  /** Each skill's own directory, for a harness that loads them one at a time (Pi). */
  skillDirs: string[];
  marketplace: string;
  plugin: string;
}

/**
 * Write the marketplace mirror for `base` under `dir`, and say where
 * everything landed. `transport` picks which rendering the skills teach:
 * `curl` for API actions, `mcp` for MCP actions. Delivery is installed in
 * both cases; action vocabulary is an independent compiler choice.
 */
export function materializePlugin(dir: string, base: string, transport: 'curl' | 'mcp' = 'mcp'): PluginKit {
  fs.rmSync(dir, { recursive: true, force: true });
  for (const [rel, contents] of Object.entries(buildMirrorFiles(base, transport))) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, contents);
  }
  const pluginDir = path.join(dir, 'plugins', PLUGIN_NAME);
  // The plugin ships a `.mcp.json` naming the artifact-bin MCP server with NO credentials —
  // right for a person, who authenticates it through OAuth in their browser. Here it is a
  // trap: installed_skill modes drop `--bare`, which is exactly what turns MCP discovery on, so
  // Claude Code loaded the server, reported `"status":"needs-auth"`, and left a 401 in every
  // task of the matrix. Stripped in EVERY eval mode — `installed_skill+mcp_action` connects the server
  // through the harness's own MCP config carrying the task's token, and this credential-less
  // copy beside it would register the same server a second time, unauthenticated.
  fs.rmSync(path.join(pluginDir, '.mcp.json'), { force: true });
  const skillsRoot = path.join(pluginDir, 'skills');
  const skillDirs = fs.readdirSync(skillsRoot, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => path.join(skillsRoot, e.name));
  return { marketplaceDir: dir, pluginDir, skillDirs, marketplace: MARKETPLACE_NAME, plugin: PLUGIN_NAME };
}

/**
 * OpenCode discovers skills from the PROJECT — it has no install command — so
 * they are copied into the working directory the agent runs in.
 */
export function copySkillsInto(kit: PluginKit, cwd: string, dotDir = '.opencode'): string {
  const dest = path.join(cwd, dotDir, 'skills');
  fs.mkdirSync(dest, { recursive: true });
  for (const skill of kit.skillDirs) {
    fs.cpSync(skill, path.join(dest, path.basename(skill)), { recursive: true });
  }
  return dest;
}
