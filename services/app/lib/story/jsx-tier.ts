/**
 * The `markup` content tier — the minusx stories engine's publish path.
 *
 * A markup artifact's SOURCE is the single truth: static JSX over the ported
 * shadcn kit (lib/story-ui registry) + a content-tag allowlist, validated by
 * the ported three-gate pipeline and compiled to a per-artifact Tailwind sheet
 * at publish time (classes used ∪ recipe union, all six theme token blocks —
 * theme switching is a `data-theme` attribute flip, never a recompile). The
 * the page at /a/<id> renders the source with the ported interpreter;
 * `content` stays empty for this tier.
 *
 * (The file keeps its jsx-* name because JSX is the SYNTAX; the stored and
 * wire format is `markup`.)
 *
 * Mirrors minusx `lib/data/story/file-markup.ts` JSX_STORY_CTX semantics:
 * component allowlist + STORY_HTML_TAGS + `no-inline-style` style policy, then
 * the banned-css sanitizer as belt, then the compile.
 */
import { syntaxErrorDetail } from '@/lib/jsx/syntax-error';
import { parseJsx, serializeJsx, validateJsx } from '@/lib/jsx';
import { hoistHelmet, splitHelmet, validateHelmet } from '@/lib/story/helmet';
import { fixHtmlNesting } from '@/lib/story/nesting';
import { collectRefNameUses, validateDataflow } from '@/lib/story/dataflow';
import { JSX_STORY_COMPONENT_NAMES } from '@/lib/jsx/components';
import { STORY_HTML_TAGS } from '@/lib/story-ui/component-names';
import { sanitizeStoryMarkupCss } from '@/lib/data/story/banned-css';
import { RETIRED_STORY_THEMES } from '@/lib/data/story/story-themes';
import { remapMarkupStyleViewportUnits } from '@/lib/story-surface/viewport-units';
import { compileStoryCss, storyCssCompileVersion } from '@/lib/data/story/story-css.server';
import { STORY_THEME_NAMES, STORY_TEMPLATE_NAMES } from '@/lib/validation/atlas-schemas';
import { json } from '../http';
import type { ContentInputCtx, StoredContent } from './input';
import { findBrokenEmbeds, findExternalSubresources } from './refs';
import { collectExternalAssetUrls } from './external-images';
import type { AssetWarning } from '@/lib/web-assets';
import { documentFonts, invalidFontFamilies } from './document-fonts';
import { MAX_EXTERNAL_IMAGES_PER_PUBLISH } from '@/lib/config';
import { checkDocumentData } from './data-checks';

/** The full story vocabulary: kit registry + the data embeds (minusx JSX_STORY_COMPONENT_NAMES verbatim). */
export const JSX_TIER_COMPONENTS = JSX_STORY_COMPONENT_NAMES;

const COLOR_MODES = ['light', 'dark'] as const;

/**
 * Store markup in the serializer's canonical form — the invariant the edit
 * protocol rests on (concurrent-artifacts-edits.md). `serializeJsx` normalizes
 * expression values to JSON (`{{kind:"x"}}` → `{{"kind":"x"}}`), so a
 * non-canonical stored doc would make the WYSIWYG's first whole-tree
 * re-serialize differ far outside the edited node, and every derived splice
 * would swallow the document. Canonical form is a FIXPOINT, so after this the
 * editor's output differs only where the human actually edited.
 *
 * Source that cannot re-parse is returned untouched: publish validation has
 * already run and would have rejected it, and silently mangling text is worse
 * than a non-canonical row (the protocol degrades to whole-doc conflicts).
 */
export function canonicalizeMarkup(source: string): string {
  const parsed = parseJsx(source);
  if (!parsed.ok) return source;
  /*
   * Normalizing may MOVE a Helmet; it may never delete one. `hoistHelmet`
   * keeps the first and drops the rest, which is only correct for a document
   * the grammar already admits — and this runs on unvalidated source in the
   * edit path (applyEditScoped derives its splice against canonical form).
   * There, a second Helmet stopped being the author error it is and became
   * silent destruction of everything the surviving one did not carry: the
   * stylesheet, the meta pairs, the script. The editor's code mode reported
   * "saved" over it.
   *
   * So an invalid document goes through untouched, exactly as the unparseable
   * case does, and `validateHelmet` gets to say what is wrong with it.
   */
  if (validateHelmet(parsed.nodes).length > 0) return source;
  // Canonical placement is part of canonical FORM: the Helmet (if any) is
  // hoisted to first top-level node here, so agents see the move in the write
  // echo and every stored document reads document = [Helmet?, ...body].
  //
  // …and so is nesting the HTML parser will not undo. A `<p>` holding block
  // content serializes to markup that parses back as a DIFFERENT tree, which
  // is a hydration mismatch and a visible repaint on every read
  // (lib/story/nesting.ts). Canonical form is the right door precisely because
  // it is re-derived on every write: the editor's re-serialization, the edit
  // protocol's base, publish and preview all pass through here, so none of
  // them can reintroduce it.
  return serializeJsx(fixHtmlNesting(hoistHelmet(parsed.nodes)));
}

export async function publishJsx(body: Record<string, unknown>, sourceIn: string, ctx: ContentInputCtx = {}): Promise<StoredContent | Response> {
  const source = sourceIn;
  const theme = body.theme ?? null;
  // Retired names are rejected BY NAME with a hint naming the successor —
  // stored rows alias forward at read time (resolveStoredStoryDesign), but a
  // NEW publish must learn the live vocabulary, same pattern as the retired
  // input formats in lib/story/input.ts.
  if (typeof theme === 'string' && theme in RETIRED_STORY_THEMES) {
    return json({ error: 'retired_theme', hint: RETIRED_STORY_THEMES[theme].hint, allowed: STORY_THEME_NAMES }, 400);
  }
  if (theme !== null && !STORY_THEME_NAMES.includes(theme as never)) {
    return json({ error: 'unknown_theme', allowed: STORY_THEME_NAMES }, 400);
  }
  const template = body.template ?? null;
  if (template !== null && !STORY_TEMPLATE_NAMES.includes(template as never)) {
    return json({ error: 'unknown_template', allowed: STORY_TEMPLATE_NAMES }, 400);
  }
  const colorMode = body.colorMode ?? null;
  if (colorMode !== null && !COLOR_MODES.includes(colorMode as never)) {
    return json({ error: 'unknown_color_mode', allowed: COLOR_MODES }, 400);
  }

  /*
   * IMPORT, AND KEEP THE URL. Every web URL the document names in an image
   * position — and every `@font-face` src in its own stylesheet — is fetched
   * once into the global asset cache (lib/web-assets) and the SOURCE IS LEFT
   * ALONE: the author wrote a URL and reads a URL back, while the served
   * document is pointed at our copy on the way out (lib/story/asset-url), which
   * is what satisfies the sandbox's `img-src 'self'` and keeps a reader's
   * browser away from the upstream host.
   *
   * A URL that will not import is a WARNING, never a refusal: the document is
   * fine, one picture is missing, and an author can act on a named failure. The
   * CAP is checked hook-or-no-hook, which is what keeps /api/preview (no import
   * hook, no fetches) agreeing with publish.
   */
  const externalAssets = collectExternalAssetUrls(source);
  if (externalAssets.images.length > MAX_EXTERNAL_IMAGES_PER_PUBLISH) {
    return json({
      error: 'too_many_external_images',
      details: [`this publish imports ${externalAssets.images.length} external images; the cap is ${MAX_EXTERNAL_IMAGES_PER_PUBLISH} — upload the rest as image artifacts and reference them as ref:<id>`],
    }, 400);
  }
  const warnings: AssetWarning[] = [];
  if (ctx.importAsset) {
    for (const url of externalAssets.images) {
      const refused = await ctx.importAsset(url, 'image');
      if (refused) warnings.push(refused);
    }
    for (const url of externalAssets.fonts) {
      const refused = await ctx.importAsset(url, 'font');
      if (refused) warnings.push(refused);
    }
    // A PDF a <File> card names by URL: the same import, its own cap, and the
    // same warning shape when it will not come — one dead link must not cost
    // an author their document.
    for (const url of externalAssets.pdfs) {
      const refused = await ctx.importAsset(url, 'pdf');
      if (refused) warnings.push(refused);
    }
  }

  // Gate 1: the ported three-gate pipeline (registry, handlers, URL schemes).
  // Gate 2 (artifactbin's own): every subresource must be self-contained —
  // see findExternalSubresources for why this can't live in the ported engine.
  // The Helmet subtree is validated by ITS grammar (lib/story/helmet.ts) and
  // split out before the generic gate — lib/jsx never learns Helmet exists,
  // and body nodes keep their original spans so diagnostics stay precise.
  const parsed = parseJsx(source);
  if (!parsed.ok) {
    return json({ error: 'invalid_jsx', details: [syntaxErrorDetail(source, parsed)] }, 400);
  }
  const split = splitHelmet(parsed.nodes);
  const helmetErrors = validateHelmet(parsed.nodes);

  // FONTS the document asks for (Helmet <meta name="font-display" …>),
  // resolved at PUBLISH so a reader never waits on — or is exposed to — an
  // upstream: lib/webfonts copies the faces into our object store and every
  // render serves them from this origin. Bundled families short-circuit. An
  // unknown family FAILS the publish: a document that silently fell back to
  // sans-serif would look like it worked.
  const fonts = documentFonts(split.content);
  const badFamilies = invalidFontFamilies(fonts);
  if (badFamilies.length > 0) {
    return json({ error: 'unknown_font', details: badFamilies.map((f) => `"${f}" is not a font family name`) }, 400);
  }
  if (ctx.resolveFont) {
    for (const family of fonts.families) {
      const failure = await ctx.resolveFont(family);
      if (failure) return failure;
    }
  }
  const errors = [
    ...helmetErrors,
    ...validateJsx(split.body, {
      components: JSX_TIER_COMPONENTS,
      allowedHtmlTags: STORY_HTML_TAGS,
      stylePolicy: 'no-inline-style',
    }),
    ...findExternalSubresources(source),
    // An embed with no data prop publishes fine and renders empty — reject it.
    ...findBrokenEmbeds(source),
    // The dataflow graph: every `$name` names a declaration of the right kind,
    // every SQL $param a scalar, no cycles. Structural, so it runs on EVERY
    // write including /api/preview (which has no ref loader) — a draft that
    // previews must publish. Skipped only when the Helmet itself is malformed
    // (its declarations are then unreliable, and those errors are already listed).
    ...(helmetErrors.length ? [] : validateDataflow({ values: split.content.values, queries: split.content.queries, mutations: split.content.mutations }, collectRefNameUses(split.body))),
  ];
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

  // Belt to the validator's no-inline-style gate: strip banned CSS declarations
  // (fixed/sticky positioning, external url()/@import) from authored style
  // content, then remap viewport-height units in it — authored `<style>` renders
  // straight through the interpreter, so the compiled-sheet injection remap
  // never sees it (lib/story-surface/viewport-units.ts).
  const sanitized = canonicalizeMarkup(remapMarkupStyleViewportUnits(sanitizeStoryMarkupCss(source)));

  // The reference graph: every ref:<id> resolves to one of the
  // caller's artifacts, with bidirectional binding validation. Skipped when no
  // loader is supplied (the /api/preview draft compile).
  // …plus the SQL dry run (every <Query> must PREPARE against the real
  // dataset shapes — a typo'd column, a non-SELECT, a missing table are 400s
  // with the engine's own message, which names candidates) and every chart
  // bound to a query checked against that query's result columns. ONE module
  // (lib/story/data-checks) shared with the dataset-refresh warnings path.
  let refs: Array<{ id: string; kind: string }> = [];
  if (ctx.loadRef) {
    const checked = await checkDocumentData(sanitized, ctx.loadRef);
    if (!checked.ok) return json({ error: checked.error, details: checked.details }, 400);
    refs = checked.refs;
  }

  const compiledCss = await compileStoryCss(sanitized, { force: true });

  // The Helmet <title> names the document when the request carries no explicit
  // title — same precedence markdown's `# heading` derivation has at the door.
  const canonical = parseJsx(sanitized);
  const helmetTitle = canonical.ok ? splitHelmet(canonical.nodes).content.title : null;

  return {
    format: 'markup',
    content: '',
    source: sanitized,
    meta: {
      format: 'markup',
      theme,
      template,
      colorMode,
      compiledCss,
      cssCompileVersion: storyCssCompileVersion(),
      refs,
    },
    derivedTitle: helmetTitle?.trim() || null,
    ...(warnings.length ? { warnings } : {}),
  };
}

