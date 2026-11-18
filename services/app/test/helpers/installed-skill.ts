/**
 * The skill's scripts installed the way its archive installs them (with the bundled platform and preview parser), and
 * a runner for one command in a child process that returns what an agent's shell shows: exit code, stdout, stderr.
 */
import {execFile} from 'node:child_process';
import {mkdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {buildPreviewParser, buildToolboxPlatform, skillPackageFiles, skillTree} from '@/lib/skills';

interface ScriptRun {code: number; stdout: string; stderr: string}
export type RunScript = (script: string, args: string[], env: Record<string, string>) => Promise<ScriptRun>;

/** Installs the scripts for `origin` under `dir`; the runner always passes --no-update. */
export async function installSkillScripts(dir: string, origin: string): Promise<RunScript> {
  const files = skillPackageFiles(skillTree(), origin);
  files['scripts/toolbox-platform.mjs'] = await buildToolboxPlatform();
  files['scripts/preview-html.mjs'] = await buildPreviewParser(files['scripts/preview-html.mjs']!);
  await mkdir(path.join(dir, 'scripts'), {recursive: true});
  for (const [name, content] of Object.entries(files)) if (name.startsWith('scripts/')) await writeFile(path.join(dir, name), content);
  return (script, args, env) => new Promise(resolve => execFile(process.execPath, [path.join(dir, 'scripts', script), ...args, '--no-update'],
    {env: {...process.env, ...env}}, (error, stdout, stderr) => resolve({code: error ? Number(error.code) || 1 : 0, stdout, stderr})));
}
