/** Materialize the released local skill bundle for isolated harness discovery. */
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
export function materializePlugin(dir: string, base: string): PluginKit {
  fs.rmSync(dir, { recursive: true, force: true });
  for (const [rel, contents] of Object.entries(buildMirrorFiles(base))) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, contents);
  }
  const pluginDir = path.join(dir, 'plugins', PLUGIN_NAME);
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
