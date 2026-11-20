/**
 * Rendering a skill file: nunjucks with delimiters `[[ value ]]` and `[% tag %]`, so code samples that
 * write JSX object props (`{{…}}`) need no `{% raw %}`. `throwOnUndefined` is on: a typo in a variable
 * name is a build failure, never an empty string on the page.
 *
 * Globals: `base` (the serving origin), `credentialPath` (where the author scripts keep that origin's
 * credentials), `authenticationInstruction`, `references` (the relative link prefix: `references/` from
 * SKILL.md, empty from a reference) and `shipped` (true for the downloadable zip, which leaves out prose
 * that links guides served only over HTTP) and `extras` (true when the zip carries this deployment's `extras/`).
 * `connectors`: the connectors this build runs, generated from the registry (`@artifactbin/connectors`).
 * `defaultSystem`: this server's default design system (lib/html-systems defaultHtmlSystem: APP__DEFAULT_DESIGN_SYSTEM,
 * else the installation system) as {slug}, or null; SKILL.md then has agents use it. `installedSystem`: the
 * installation system (APP__DESIGN_SYSTEM_DIR) as {slug, mood, fits}, or null: its table row. `fits(slug, text)`: a
 * table row's Fits cell, marked as this server's default on the default's row only.
 */
import { credentialPaths } from '@artifactbin/utils/node/credentials';
import path from 'node:path';
import nunjucks from 'nunjucks';
import type { SkillFile } from './tree';
import { AUTHENTICATION_INSTRUCTION } from './agent-discovery';
import { connectorList } from '@artifactbin/connectors';
import { defaultHtmlSystem, htmlSystemLabel, installationDesignSystem } from '@/lib/html-systems';

const CONNECTORS = connectorList().filter((c) => c.available).map((c) => c.label).join(', ');

export interface RenderOptions {
  base: string;
  /** Render for the downloadable skill folder: prose that links guides served only over HTTP is left out. */
  shipped?: boolean;
  /** The downloadable skill carries deployment extras (./extras): SKILL.md names their index. */
  extras?: boolean;
}

const env = new nunjucks.Environment(new nunjucks.FileSystemLoader(path.resolve(process.cwd(), 'skills/artifactbin'), { noCache: true }), {
  autoescape: false,
  throwOnUndefined: true,
  trimBlocks: true,
  lstripBlocks: true,
  tags: { variableStart: '[[', variableEnd: ']]', blockStart: '[%', blockEnd: '%]', commentStart: '[[#', commentEnd: '#]]' },
});

function defaultSystem() {
  const slug = defaultHtmlSystem();
  return slug ? { slug } : null;
}
/** The installation system's table fields (validated at boot: no `|`, backticks or line breaks). */
function installedSystem() {
  const system = installationDesignSystem();
  return system ? { slug: system.slug, mood: system.mood, fits: system.fits } : null;
}
/** A table row's Fits cell; the default's row says so, with its label (and "light only" for a light-only system). */
function fits(slug: string, text: string): string {
  if (slug !== defaultHtmlSystem()) return text;
  const lightOnly = installationDesignSystem()?.slug === slug && !installationDesignSystem()!.dark;
  return `This server's default (${htmlSystemLabel(slug)}${lightOnly ? ', light only' : ''}): ${text}`;
}

export function renderSkill(file: SkillFile, opts: RenderOptions): string {
  try {
    return env.renderString(file.body, {
      base: opts.base,
      credentialPath: credentialPaths(opts.base, '~/.artifactbin').backingPath,
      shipped: opts.shipped === true,
      extras: opts.extras === true,
      authenticationInstruction: AUTHENTICATION_INSTRUCTION,
      connectors: CONNECTORS,
      defaultSystem: defaultSystem(),
      installedSystem: installedSystem(),
      fits,
      references: file.ref ? '' : 'references/',
    }).replace(/\n{3,}/g, '\n\n');
  } catch (error) {
    throw new Error(`skills/${file.path}: ${(error as Error).message}`);
  }
}
