/**
 * Rendering a skill file: nunjucks over the REGISTRIES, so a name, a count or
 * a description in the docs comes from the code that accepts it and cannot
 * drift (the one property the old template-literal builders had that the
 * files keep).
 *
 * Delimiters are `[[ value ]]` and `[% tag %]`, not nunjucks' defaults: the
 * corpus writes JSX object props (`viz={{"kind":…}}`) 14 times and `[[`/`[%`
 * never, so the defaults would have needed a `{% raw %}` around every code
 * span. `throwOnUndefined` is on — a typo in a variable name is a build
 * failure, never an empty string on the page (the lenient default renders
 * `[[ basee ]]` as nothing, silently). No `if`: a file that needs one is two
 * files.
 *
 * Globals: `base` (the caller's origin — the ONLY runtime value; the CLI
 * bundle renders it once with the production base), `example` (the brief's
 * inlined document, read from `skills/artifactbin/example.jsx` for `SKILL.md` only), `themes`, `templates`,
 * `components`, `tags`, `refusedTags`, `maxContentBytes`, `claim` (the advice
 * relayed to a person about their anonymous token), and
 * — inside `themes/<n>.md` / `templates/<n>.md` — that file's own registry
 * entry as `theme` / `template`.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import nunjucks from 'nunjucks';
import { STORY_THEMES } from '@/lib/data/story/story-themes';
import { STORY_TEMPLATES } from '@/lib/data/story/story-templates';
import { STORY_HTML_TAGS, STORY_UI_COMPONENT_NAME_LIST } from '@/lib/story-ui/component-names';
import { DANGEROUS_TAGS } from '@/lib/jsx/dangerous-tags';
import { MAX_CONTENT_BYTES } from '@/lib/story/input';
import { MAX_EXTERNAL_ASSETS_PER_PUBLISH, MAX_IMAGE_BYTES, MAX_PDF_BYTES } from '@/lib/config';
import { COMPUTED_FIGURE_RULE } from '@/lib/agent-guidance';
import { OPERATIONS } from '@/lib/operations/registry';
import { anonymousClaimRelay } from '@/lib/agent-copy';
import type { SkillFile } from './tree';

export interface RenderOptions { base: string }

/** The complete example document the brief inlines verbatim; `afbin help example` prints the same file. */
export function skillExample(root = path.resolve(process.cwd(), 'skills')): string {
  return readFileSync(path.join(root, 'artifactbin', 'example.jsx'), 'utf8');
}

const env = new nunjucks.Environment(null, {
  autoescape: false,
  throwOnUndefined: true,
  trimBlocks: true,
  lstripBlocks: true,
  tags: { variableStart: '[[', variableEnd: ']]', blockStart: '[%', blockEnd: '%]', commentStart: '[[#', commentEnd: '#]]' },
});

const REGISTRY_GLOBALS = {
  /** The operations registry, projected for the docs: what exists, at which address, under which tool name. */
  operations: OPERATIONS.map((o) => ({ name: o.name, title: o.title, method: o.http.method, path: o.http.path, readOnly: !!o.annotations.readOnly })),
  /** The tool list as one string — `create_artifact`, `update_artifact`, … */
  opNames: OPERATIONS.map((o) => `\`${o.name}\``).join(', '),
  themes: STORY_THEMES.map((t) => ({
    name: t.name, label: t.label, description: t.description, defaultMode: t.defaultMode,
    fonts: [`display ${t.fonts.display}`, `body ${t.fonts.body}`, ...(t.fonts.mono ? [`mono ${t.fonts.mono}`] : [])].join(', '),
    /** The description up to its first clause — the palette and the mood decide a pick; the radius does not. */
    short: t.description.replace(/\s+/g, ' ').trim().split('. ')[0].split(';')[0].trim(),
  })),
  templates: STORY_TEMPLATES.map((t) => ({ name: t.name, label: t.label, description: t.description, personality: t.personality, beats: t.beats })),
  components: STORY_UI_COMPONENT_NAME_LIST,
  tags: STORY_HTML_TAGS,
  refusedTags: [...DANGEROUS_TAGS],
  maxContentBytes: MAX_CONTENT_BYTES.toLocaleString('en-US'),
  maxImageBytes: MAX_IMAGE_BYTES.toLocaleString('en-US'),
  maxPdfBytes: MAX_PDF_BYTES.toLocaleString('en-US'),
  /** The cap on how many external urls ONE document may import (images, faces and PDFs). */
  maxExternalAssets: MAX_EXTERNAL_ASSETS_PER_PUBLISH,
  /** One shared sentence for validation and authoring guidance — the rule that figures are computed, never typed. */
  computedFigureRule: COMPUTED_FIGURE_RULE,
};

export function renderSkill(file: SkillFile, opts: RenderOptions): string {
  // ONE source for this advice: agent-copy's fifth string, the line an agent relays about an orphaned
  // document. The docs render it for a stand-in id, so the words a reader sees are the words we hand over.
  const claim = anonymousClaimRelay(opts.base, '<id>');
  const own: Record<string, unknown> = {};
  const entry = file.file.replace(/\.md$/, '');
  if (file.ref && entry.startsWith('themes-')) own.theme = REGISTRY_GLOBALS.themes.find((t) => t.name === entry.slice('themes-'.length));
  if (file.ref && entry.startsWith('templates-')) own.template = REGISTRY_GLOBALS.templates.find((t) => t.name === entry.slice('templates-'.length));
  try {
    return env.renderString(file.body, {
      ...REGISTRY_GLOBALS,
      base: opts.base,
      // Only the brief inlines the example; a reference that names it is a build failure, by design.
      ...(file.file === 'SKILL.md' && !file.ref ? { example: skillExample().trimEnd() } : {}),
      claim,
      publishExample: '```sh\nafbin push report.jsx\n```',
      editExample: 'Edit the local JSX file, then run `afbin push report.jsx`.',
      readBackCall: '`afbin pull`',
      authRule: 'afbin authenticates itself in the browser when it needs the server; run `afbin auth` to sign in deliberately.',
      checkWork: 'Run `afbin validate report.jsx` locally before `afbin push report.jsx`. Use `afbin help operations` for image export.',
      docsMoreLine: 'Open the relevant local file in `references/` beside this skill.',
      docsIndexHint: 'all beside this file under `references/`',
      ...own,
    }).replace(/\n{3,}/g, '\n\n');
  } catch (error) {
    throw new Error(`skills/${file.path}: ${(error as Error).message}`);
  }
}
