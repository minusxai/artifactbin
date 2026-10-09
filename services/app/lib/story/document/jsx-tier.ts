/**
 * The `markup` content tier — the minusx stories engine's publish path.
 *
 * A markup artifact's SOURCE is the single truth: static JSX over the ported
 * shadcn kit (lib/story-ui registry) + a content-tag allowlist, validated by
 * the ported three-gate pipeline and compiled to a per-artifact Tailwind sheet
 * at publish time (classes used ∪ recipe union, all six theme token blocks —
 * theme switching is a `data-theme` attribute flip, never a recompile). The
 * the page at /a/<id> renders the source with the ported interpreter;
 *
 * (The file keeps its jsx-* name because JSX is the SYNTAX; the stored and
 * wire format is `markup`.)
 *
 * The validation chain:
 * component allowlist + STORY_HTML_TAGS + `no-inline-style` style policy, then
 * the compile.
 */
import { validateMarkupStructure } from '../../document/local-validation';
import { repairJsxSource } from '@/lib/jsx/repair';
import { canonicalizeMarkup } from '../../document/canonical-source';
export {canonicalizeMarkup} from '../../document/canonical-source';
import { parseJsx } from '@/lib/jsx';
import { splitHelmet } from '@/lib/document/helmet';
import { JSX_STORY_COMPONENT_NAMES } from '@/lib/jsx/components';
import { STORY_HTML_TAGS } from '@/lib/jsx/component-names';
import { authorModuleNames, buildAuthorModule, type AuthorModule } from '@/lib/author-script/author-module.server';
import { compileStoryCss, storyCssCompileVersion } from '@/lib/data/story/story-css.server';
import { STORY_DESIGN_NAMES, STORY_TEMPLATE_NAMES } from '@/lib/validation/atlas-schemas';
import { json } from '../../http/http';
import { type ContentInputCtx } from './input';
import type { StoredContent } from '@/lib/document/stored-content';
import { MAX_DOCUMENT_BYTES } from '@artifactbin/contracts';
import { documentFonts, invalidFontFamilies } from '@/lib/compiled-page/styles/document-fonts';
import { cspExtensionsOf } from '../../document/csp-extensions';
import { checkDocumentData } from '../data/data-checks';
import { COMPILED_DATAFLOW } from '@/lib/document/server';
import { buildLambdaModule } from '@/lib/author-script/program.server';
import { EMPTY_COMPILED_DATAFLOW } from '@/lib/dataflow/compiled-dataflow';
import { validateIconNames } from '../assets/icon-validation.server';

/** The full story vocabulary: kit registry + the data embeds (minusx JSX_STORY_COMPONENT_NAMES verbatim). */
export const JSX_TIER_COMPONENTS = JSX_STORY_COMPONENT_NAMES;

const COLOR_MODES = ['light', 'dark'] as const;

interface PreparedMarkup {
  content: StoredContent;
}

/** Validation and compilation have no import or persistence capability. */
export async function prepareJsx(body: Record<string, unknown>, sourceIn: string, ctx: Pick<ContentInputCtx, 'loadRef' | 'normalizeMarkup'> = {}): Promise<PreparedMarkup | Response> {
  if(sourceIn.includes('\0'))return json({error:'invalid_source_encoding',details:['Document source cannot contain a NUL character.']},400);
  // Match UTF-8 transport before validation rather than changing bytes at SQL time.
  if(!sourceIn.isWellFormed())sourceIn=Buffer.from(sourceIn,'utf8').toString('utf8');
  /*
   * REPAIR FIRST, above everything that reads the source. The one fault we fix
   * rather than refuse is the shell-escaped backtick (lib/jsx/repair — it costs
   * an agent minutes and cannot be meant). Free for every document that does
   * not carry the sequence.
   */
  const repaired = repairJsxSource(sourceIn);
  const source = repaired ? repaired.source : sourceIn;
  const repairs = repaired ? [repaired.repair] : [];
  /** What the door changed, for the reply — absent when it changed nothing. */

  const theme = body.theme ?? (body.template === 'doc' ? 'meridian' : null);
  if (theme !== null && !STORY_DESIGN_NAMES.includes(theme as never)) {
    return json({ error: 'unknown_theme', allowed: STORY_DESIGN_NAMES }, 400);
  }
  const template = body.template ?? null;
  if (template !== null && !STORY_TEMPLATE_NAMES.includes(template as never)) {
    return json({ error: 'unknown_template', allowed: STORY_TEMPLATE_NAMES }, 400);
  }
  const colorMode = body.colorMode ?? null;
  if (colorMode !== null && !COLOR_MODES.includes(colorMode as never)) {
    return json({ error: 'unknown_color_mode', allowed: COLOR_MODES }, 400);
  }

  // A web URL in an image or file position is served as written: the document is its own page under a
  // CSP that admits `img-src https:`, so publish fetches nothing and stores no copy.

  // Gate 1: the ported three-gate pipeline (registry, handlers, URL schemes).
  // Gate 2 (artifactbin's own): every subresource must be self-contained —
  // see findExternalSubresources for why this can't live in the ported engine.
  // The Helmet subtree is validated by ITS grammar (lib/document/helmet.ts) and
  // split out before the generic gate — lib/jsx never learns Helmet exists,
  // and body nodes keep their original spans so diagnostics stay precise.
  // The script first: its build errors are the publish's (a typo'd declared name, a syntax error, a relative
  // import), and its exports are the components the markup may mount, which the structural check needs.
  let structural = validateMarkupStructure(source, { scriptComponents: new Set<string>() });
  let split = structural.split;
  if (!split) return json({error:'invalid_jsx',details:structural.errors},400);
  let authorModule: AuthorModule | null = null;
  if (split.content.script) {
    const built = await buildAuthorModule(split.content.script, authorModuleNames(split.content));
    if (!built.ok) return json({ error: 'invalid_script', details: built.errors.map((message) => ({ message })) }, 400);
    authorModule = built.module;
    structural = validateMarkupStructure(source, { scriptComponents: new Set(authorModule.exports) });
    split = structural.split!;
  }

  // FONTS the document asks for (Helmet <meta name="font-display" …>): only the NAME is checked here,
  // because it lands in a stylesheet. Nothing is fetched or stored: serving emits the Google Fonts
  // `@import` from the meta (lib/compiled-page/styles/document-fonts), and a bundled family is served from this origin.
  const fonts = documentFonts(split.content);
  const badFamilies = invalidFontFamilies(fonts);
  if (badFamilies.length > 0) {
    return json({ error: 'unknown_font', details: badFamilies.map((f) => `"${f}" is not a font family name`) }, 400);
  }
  // The hosts a document asks for beyond the default policy (Helmet `<meta name="csp-…">`), validated
  // here so a bad origin is named as what it is. Nothing is stored: serving reads each version's own
  // source (lib/trust/document-trust). The same parser runs in validateMarkupStructure for `afbin validate`.
  const csp = cspExtensionsOf(split.content, split.helmet);
  if (!csp.ok) return json({ error: 'invalid_csp', details: csp.errors }, 400);
  const errors = [...structural.errors, ...validateIconNames(split.body)];
  if (errors.length > 0) {
    // An agent's only route out of a tag rejection is knowing the set. It rides
    // ONCE on the response — not inside each offending tag's message, which is
    // how a rejection turns into context bloat — and only when a tag was the
    // problem, so every other failure stays as small as it was.
    const refusedATag = errors.some((e) => e.message.includes('allowed_html_tags'));
    return json({
      error: 'invalid_jsx',
      details: errors,
      ...(refusedATag ? { allowed_html_tags: [...STORY_HTML_TAGS] } : {}),
    }, 400);
  }

  // Authored CSS is stored as written: the document is its own page, so nothing in it needs stripping.
  const normalization = ctx.normalizeMarkup?.(canonicalizeMarkup(source)) ?? source;
  const normalized = typeof normalization === 'string' ? normalization : normalization.source;
  if (typeof normalization !== 'string') repairs.push(...normalization.repairs);
  const sanitized = canonicalizeMarkup(normalized);
  if(sanitized.includes('\0'))return json({error:'invalid_source_encoding',details:['Document source cannot contain a NUL character.']},400);
  if(!sanitized.isWellFormed())return prepareJsx(body,Buffer.from(sanitized,'utf8').toString('utf8'),ctx);
  if (Buffer.byteLength(sanitized, 'utf8') > MAX_DOCUMENT_BYTES) return json({ error: 'too_large', maxBytes: MAX_DOCUMENT_BYTES }, 413);

  // The reference graph: every ref:<id> resolves to one of the
  // caller's artifacts, with bidirectional binding validation. Skipped when no
  // loader is supplied (the /api/preview draft compile).
  // …plus the SQL dry run (every <Query> must PREPARE against the real
  // dataset shapes — a typo'd column, a non-SELECT, a missing table are 400s
  // with the engine's own message, which names candidates) and every chart
  // bound to a query checked against that query's result columns. ONE module
  // (lib/story/data/data-checks) shared with the dataset-refresh warnings path.
  let refs: Array<{ id: string; kind: string }> = [];
  let compiled: import('@/lib/dataflow/compiled-dataflow').CompiledDataflow | null = null;
  if (ctx.loadRef) {
    const checked = await checkDocumentData(sanitized, ctx.loadRef);
    if (!checked.ok) return json({ error: checked.error, details: checked.details }, 400);
    refs = checked.refs;
    compiled = checked.compiled;
  }

  if (split.content.serverScript !== undefined) {
    try { await buildLambdaModule(split.content.serverScript, compiled ?? EMPTY_COMPILED_DATAFLOW, authorModuleNames(split.content)); }
    catch (error) { return json({error:'invalid_server_script',details:[{message:error instanceof Error?error.message:'Server handler compilation failed'}]},400); }
  }
  const compiledCss = await compileStoryCss(sanitized, { force: true });

  // The Helmet <title> names the document when the request carries no explicit
  // title — same precedence markdown's `# heading` derivation has at the door.
  const canonical = parseJsx(sanitized);
  const helmetTitle = canonical.ok ? splitHelmet(canonical.nodes).content.title : null;

  const content: StoredContent = {
    format: 'markup',
    source: sanitized,
    meta: {
      format: 'markup',
      theme,
      template,
      colorMode,
      compiledCss,
      cssCompileVersion: storyCssCompileVersion(),
      refs,
      // The compiled dataflow, for the commit to bind to the final source (lib/document/parsed-artifact-metadata).
      ...(compiled ? { [COMPILED_DATAFLOW]: compiled } : {}),
    },
    derivedTitle: helmetTitle?.trim() || null,
    ...(repairs.length ? {repairs} : {}),
  };
  return {content};
}

export async function publishJsx(body: Record<string, unknown>, source: string, ctx: ContentInputCtx = {}): Promise<StoredContent | Response> {
  const prepared = await prepareJsx(body, source, ctx);
  return prepared instanceof Response ? prepared : prepared.content;
}
