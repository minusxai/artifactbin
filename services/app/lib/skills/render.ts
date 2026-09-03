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
 * Globals: `base` (the caller's origin — the ONLY runtime value; the plugin
 * renders it once with the production base), `themes`, `templates`,
 * `components`, `tags`, `refusedTags`, `maxContentBytes`, `claim` (the advice
 * relayed to a person about their anonymous token), and
 * — inside `themes/<n>.md` / `templates/<n>.md` — that file's own registry
 * entry as `theme` / `template`.
 */
import nunjucks from 'nunjucks';
import { STORY_THEMES } from '@/lib/data/story/story-themes';
import { STORY_TEMPLATES } from '@/lib/data/story/story-templates';
import { STORY_HTML_TAGS, STORY_UI_COMPONENT_NAME_LIST } from '@/lib/story-ui/component-names';
import { DANGEROUS_TAGS } from '@/lib/jsx/dangerous-tags';
import { MAX_CONTENT_BYTES } from '@/lib/story/input';
import { MAX_PDF_BYTES, MAX_IMAGE_BYTES } from '@/lib/config';
import { COMPUTED_FIGURE_RULE } from '@/lib/agent-guidance';
import { OPERATIONS } from '@/lib/operations/registry';
import type { SkillFile } from './tree';

/**
 * Which action transport a rendering TEACHES: `curl` for API calls, `mcp` for
 * tool calls. Delivery (HTTP-served or installed) is a separate option because
 * either action vocabulary can travel either way. The variation is carried by COMPUTED
 * GLOBALS (`publishExample`, `editExample`), never by `if` in a file.
 */
export type DocTransport = 'curl' | 'mcp';
export type SkillDelivery = 'http' | 'installed';

export interface RenderOptions {
  /** The caller's own origin, e.g. `https://artifactbin.dev`. */
  base: string;
  transport?: DocTransport;
  /** Where references live; independent of the compiled action vocabulary. */
  delivery?: SkillDelivery;
}

const env = new nunjucks.Environment(null, {
  autoescape: false,
  throwOnUndefined: true,
  trimBlocks: true,
  lstripBlocks: true,
  tags: { variableStart: '[[', variableEnd: ']]', blockStart: '[%', blockEnd: '%]', commentStart: '[[#', commentEnd: '#]]' },
});

/** The publish example the brief opens with, per transport (see DocTransport). */
function publishExample(base: string, transport: DocTransport): string {
  return transport === 'mcp'
    ? '```\ncreate_artifact({ "title": "…", "markup": "…", "theme": "industry", "template": "deck" })\n```'
    : '```bash\ncurl -X POST ' + base + '/api/artifacts \\\n  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \\\n  -d \'{"title":"…","markup":"…","theme":"industry","template":"deck"}\'\n```';
}

/** The targeted-edit example, per transport. */
function editExample(base: string, transport: DocTransport): string {
  return transport === 'mcp'
    ? '```\nedit_artifact({ "id": "<id>", "edit_id": "…", "old_string": "exact text once in the document", "new_string": "replacement" })\n```'
    : '```bash\ncurl -X POST ' + base + '/api/artifacts/<id>/edits \\\n  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \\\n  -d \'{"edit_id":"…","old_string":"exact text once in the document","new_string":"replacement"}\'\n```';
}

/** How the read-before-edit is made, per transport. */
function readBackCall(base: string, transport: DocTransport): string {
  return transport === 'mcp' ? '`get_artifact`' : `\`GET ${base}/api/artifacts/<id>\``;
}

/** The auth rule, per transport: MCP is authenticated by the connection; HTTP by the bearer on every call. */
function authRule(transport: DocTransport): string {
  return transport === 'mcp'
    ? '**The MCP connection is already authenticated — every call is a tool call; there is no token to manage.**'
    : '**Every `/api` call, `GET` included, sends `Authorization: Bearer <token>`.**';
}

/**
 * Checking your own render, per transport. The PNG lives at a URL in both
 * worlds (export is a page feature, not an operation), but only the curl
 * rendering phrases it as a request to make — the plugin rendering offers it
 * as the page's address and sends re-reads through the tool.
 */
function checkWork(base: string, transport: DocTransport): string {
  return transport === 'mcp'
    ? 'A successful tool call already validated the document. `export_artifact`\nreturns it as a PNG (`slide: 2` for one deck slide, 1-based) — call it only if\nyou can actually view images; otherwise re-read the markup with `get_artifact`.'
    : `A 200 already validated the document. \`GET ${base}/a/<id>/export\`\nrenders it as a PNG (\`?slide=2\` for one deck slide, 1-based) — fetch it only if\nyou can actually view images; otherwise read the stored markup back.`;
}

/**
 * How to reach MORE docs, per delivery. An HTTP agent fetches by URL (with the
 * action compiler preserved in the query); an installed agent opens the files
 * beside the skill.
 */
function docsMoreLine(base: string, transport: DocTransport, delivery: SkillDelivery): string {
  if (delivery === 'installed') {
    return 'Open ONE — the files sit under `references/` beside this skill (`grep -rl <term> references/` finds the owner).';
  }
  const query = transport === 'mcp' ? '?transport=mcp' : '';
  const archiveQuery = transport === 'mcp' ? '&transport=mcp' : '';
  return `Fetch \`${base}/docs/artifactbin/references/<file>${query}\`; the whole folder:\n\`curl -s "${base}/docs?download=true${archiveQuery}" | tar xz\`, then \`grep -rl\` it.\nNo OpenAPI, no Swagger, no \`/api/docs\`: a guess is a 404.`;
}

/** Where the file list lives (the dispatch-table intro's parenthetical). */
function docsIndexHint(base: string, transport: DocTransport, delivery: SkillDelivery): string {
  if (delivery === 'installed') return 'all beside this file under `references/`';
  return transport === 'mcp' ? `\`${base}/docs?transport=mcp\` lists them all` : `\`${base}/docs\` lists them all`;
}


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
  /** ONE sentence for the MCP schema and the docs — the rule that figures are computed, never typed. */
  computedFigureRule: COMPUTED_FIGURE_RULE,
};

export function renderSkill(file: SkillFile, opts: RenderOptions): string {
  const transport = opts.transport ?? 'curl';
  const delivery = opts.delivery ?? (transport === 'mcp' ? 'installed' : 'http');
  const claim = `*"to keep these under your account, log in at ${opts.base} and claim token \`mx_...\`"* (they paste it in the Claim box on the dashboard).`;
  const own: Record<string, unknown> = {};
  const entry = file.file.replace(/\.md$/, '');
  if (file.ref && entry.startsWith('themes-')) own.theme = REGISTRY_GLOBALS.themes.find((t) => t.name === entry.slice('themes-'.length));
  if (file.ref && entry.startsWith('templates-')) own.template = REGISTRY_GLOBALS.templates.find((t) => t.name === entry.slice('templates-'.length));
  try {
    return env.renderString(file.body, {
      ...REGISTRY_GLOBALS,
      base: opts.base,
      claim,
      publishExample: publishExample(opts.base, transport),
      editExample: editExample(opts.base, transport),
      readBackCall: readBackCall(opts.base, transport),
      authRule: authRule(transport),
      checkWork: checkWork(opts.base, transport),
      docsMoreLine: docsMoreLine(opts.base, transport, delivery),
      docsIndexHint: docsIndexHint(opts.base, transport, delivery),
      ...own,
    }).replace(/\n{3,}/g, '\n\n');
  } catch (error) {
    throw new Error(`skills/${file.path}: ${(error as Error).message}`);
  }
}
