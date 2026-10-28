/**
 * Rendering a skill file: nunjucks with delimiters `[[ value ]]` and `[% tag %]`, so code samples that
 * write JSX object props (`{{…}}`) need no `{% raw %}`. `throwOnUndefined` is on: a typo in a variable
 * name is a build failure, never an empty string on the page.
 *
 * Globals: `base` (the serving origin), `credentialPath` (where the author scripts keep that origin's
 * credentials), `authenticationInstruction`, `references` (the relative link prefix: `references/` from
 * SKILL.md, empty from a reference) and `shipped` (true for the downloadable zip, which leaves out prose
 * that links guides served only over HTTP).
 */
import { credentialPaths } from '@artifactbin/utils/node/credentials';
import path from 'node:path';
import nunjucks from 'nunjucks';
import type { SkillFile } from './tree';
import { AUTHENTICATION_INSTRUCTION } from '../platform/agent-discovery';

export interface RenderOptions {
  base: string;
  /** Render for the downloadable skill folder: prose that links guides served only over HTTP is left out. */
  shipped?: boolean;
}

const env = new nunjucks.Environment(new nunjucks.FileSystemLoader(path.resolve(process.cwd(), 'skills/artifactbin'), { noCache: true }), {
  autoescape: false,
  throwOnUndefined: true,
  trimBlocks: true,
  lstripBlocks: true,
  tags: { variableStart: '[[', variableEnd: ']]', blockStart: '[%', blockEnd: '%]', commentStart: '[[#', commentEnd: '#]]' },
});

export function renderSkill(file: SkillFile, opts: RenderOptions): string {
  try {
    return env.renderString(file.body, {
      base: opts.base,
      credentialPath: credentialPaths(opts.base, '~/.artifactbin').backingPath,
      shipped: opts.shipped === true,
      authenticationInstruction: AUTHENTICATION_INSTRUCTION,
      references: file.ref ? '' : 'references/',
    }).replace(/\n{3,}/g, '\n\n');
  } catch (error) {
    throw new Error(`skills/${file.path}: ${(error as Error).message}`);
  }
}
