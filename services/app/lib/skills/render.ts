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
 * `components`, `tags`, `refusedTags`, `maxContentBytes`, and
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
import { BUILTIN_INPUTS, BUILTIN_TABLES } from '@/lib/story/builtins';
import { DISPLAY_ROWS, SQL_FUNCTIONS } from '@artifactbin/contracts';
import { CORE_FUNCTIONS } from '@artifactbin/sql/core';
import type { SkillFile } from './tree';

export interface RenderOptions {
  base: string;
  /**
   * Render the CONDENSED copy: the spans a reference marks as bundle-skippable are dropped rather
   * than kept. `afbin help <template>` concatenates eight references into one answer, and at 40 KB
   * Claude Code spilled that answer to a file and read it back in three or four `sed` windows —
   * the call that exists to save calls cost four. Nothing an author needs is
   * dropped: what the markers cover is the rationale for a rule, not the rule.
   */
  bundle?: boolean;
}

/**
 * THE BUNDLE MARKER. A reference marks prose the bundled copy may do without:
 *
 *     <!--bundle:skip-->
 *     Why this rule exists, measured …
 *     <!--/bundle:skip-->
 *
 * or inline, `rule<!--bundle:skip--> (because …)<!--/bundle:skip-->`. Full rendering — the
 * installed `references/` files, `afbin help <topic>` — strips the MARKERS and keeps every byte
 * between them, so the marked file renders exactly as it did before it was marked; only `afbin help
 * <template>`, which reads eight files at once, drops the spans. One source, two lengths, no fork.
 */
const BUNDLE_SPAN = /^[ \t]*<!--bundle:skip-->[ \t]*\r?\n([\s\S]*?)^[ \t]*<!--\/bundle:skip-->[ \t]*\r?\n|<!--bundle:skip-->([\s\S]*?)<!--\/bundle:skip-->/gm;

/** The full text: the markers go, everything they wrap stays, byte for byte. */
export function stripBundleMarkers(text: string): string {
  return text.replace(BUNDLE_SPAN, (_, block: string | undefined, inline: string | undefined) => block ?? inline ?? '');
}

/** The bundled text: the marked spans go with their markers, and the blank lines they leave close up. */
export function condenseForBundle(text: string): string {
  return text.replace(BUNDLE_SPAN, '').replace(/\n{3,}/g, '\n\n');
}

/** An opening marker without its closing one would silently ship the prose it meant to drop. */
function assertMarkersResolved(text: string, at: string): string {
  if (text.includes('bundle:skip')) throw new Error(`${at}: an unbalanced <!--bundle:skip--> marker; open and close it on lines of its own, or inline on one line.`);
  return text;
}

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

/** A Markdown table cell: a literal pipe would end it. */
const cell = (text: string): string => text.replaceAll('|', '\\|');

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
  /** The functions the engine adds to SQLite, as the engine registers them (@artifactbin/contracts SQL_FUNCTIONS). */
  sqlFunctionTable: ['| Function | What it does |', '|---|---|', ...SQL_FUNCTIONS.map((f) => `| \`${cell(f.signature)}\` | ${cell(f.summary)} |`)].join('\n'),
  /** The rows of one query result that travel to the page; the rest are paged (@artifactbin/contracts DISPLAY_ROWS). */
  displayRows: DISPLAY_ROWS.toLocaleString('en-US'),
  /** SQLite's own functions an author may call, as the engine's guard admits them, less those the library replaces. */
  sqliteFunctions: [...CORE_FUNCTIONS].filter((name) => /^[a-z]\w*$/.test(name) && !SQL_FUNCTIONS.some((f) => f.name === name)).map((name) => `\`${name}\``).join(', '),
  /** The built-in `$` values and tables, as the compiler and the server supply them (lib/story/builtins). */
  builtinTable: [
    '| Name | What it is | Where it comes from | Read by |', '|---|---|---|---|',
    ...BUILTIN_INPUTS.map((b) => `| \`$${b.name === '_row' ? '_row.<column>' : b.name}\` | ${b.summary} | ${b.source === 'platform' ? 'the platform, on every run' : 'the control that runs the mutation'} | ${b.query ? 'queries and mutations' : 'mutations only'} |`),
    ...Object.entries(BUILTIN_TABLES).map(([name, t]) => `| \`${name}\` (a table) | ${t.summary} Columns: ${t.columns.map((c) => c.name).join(', ')}. | the platform | queries and mutations |`),
  ].join('\n'),
};

export function renderSkill(file: SkillFile, opts: RenderOptions): string {
  const own: Record<string, unknown> = {};
  const entry = file.file.replace(/\.md$/, '');
  if (file.ref && entry.startsWith('themes-')) own.theme = REGISTRY_GLOBALS.themes.find((t) => t.name === entry.slice('themes-'.length));
  if (file.ref && entry.startsWith('templates-')) own.template = REGISTRY_GLOBALS.templates.find((t) => t.name === entry.slice('templates-'.length));
  try {
    const rendered = env.renderString(file.body, {
      ...REGISTRY_GLOBALS,
      base: opts.base,
      // Only the brief inlines the example; a reference that names it is a build failure, by design.
      ...(file.file === 'SKILL.md' && !file.ref ? { example: skillExample().trimEnd() } : {}),
      publishExample: '```sh\nafbin push report.jsx\n```',
      editExample: 'Edit the local JSX file, then run `afbin push report.jsx`.',
      readBackCall: '`afbin pull`',
      authRule: 'afbin authenticates itself in the browser when it needs the server; run `afbin auth` to sign in deliberately.',
      checkWork: 'Run `afbin validate report.jsx` locally before `afbin push report.jsx`. Use `afbin help operations` for image export.',
      docsMoreLine: 'Open the relevant local file in `references/` beside this skill.',
      docsIndexHint: 'all beside this file under `references/`',
      ...own,
    });
    const marked = (opts.bundle ? condenseForBundle(rendered) : stripBundleMarkers(rendered)).replace(/\n{3,}/g, '\n\n');
    return assertMarkersResolved(marked, `skills/${file.path}`);
  } catch (error) {
    throw new Error(`skills/${file.path}: ${(error as Error).message}`);
  }
}
