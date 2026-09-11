/**
 * Where the CLI's own `setup` puts skills for each harness under a run home. The eval never writes
 * skills itself: in the `installed` flow the driver runs `afbin setup`, in `not-installed` the agent
 * does, and both land here. Each adapter hands its harness the environment below, so the harness's
 * ordinary discovery finds the directory. OpenCode also reads skills from the project, so its
 * adapter copies the installed directory beside the task's files once it exists.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { Harness } from './contracts';
import { skillTargets, type SkillHarness } from '../../services/cli/src/skill-install';

export interface SkillKit {
  /** The skill directory `afbin setup --harness <h>` installs to under this run home. */
  dir: string;
  /** Every skill directory a harness that loads them one at a time (pi) is pointed at. */
  skillDirs: string[];
}

export const HARNESS_TO_SKILL: Record<Harness, SkillHarness> = { 'claude-code': 'claude', codex: 'codex', pi: 'pi', opencode: 'opencode' };

/** The environment each adapter hands its harness, which is also what `afbin setup` is given so both agree. */
export function harnessEnv(harness: Harness, homeDir: string): Record<string, string> {
  switch (harness) {
    case 'claude-code': return { CLAUDE_CONFIG_DIR: homeDir };
    case 'codex': return { CODEX_HOME: homeDir };
    case 'pi': return { PI_CODING_AGENT_DIR: homeDir };
    case 'opencode': return { OPENCODE_CONFIG_DIR: homeDir };
  }
}

export function skillKit(homeDir: string, harness: Harness): SkillKit {
  const dir = skillTargets(homeDir, harnessEnv(harness, homeDir))[HARNESS_TO_SKILL[harness]];
  return { dir, skillDirs: [dir] };
}

/** OpenCode discovers skills from the PROJECT as well, so an installed directory is copied beside the task's files. */
export function copySkillsInto(kit: SkillKit, cwd: string, dotDir = '.opencode'): string | null {
  if (!fs.existsSync(path.join(kit.dir, 'SKILL.md'))) return null;
  const dest = path.join(cwd, dotDir, 'skills');
  fs.mkdirSync(dest, { recursive: true });
  for (const skill of kit.skillDirs) fs.cpSync(skill, path.join(dest, path.basename(skill)), { recursive: true });
  return dest;
}
