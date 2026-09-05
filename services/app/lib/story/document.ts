/**
 * The served document: a stored markup row → ONE complete standalone HTML
 * page. This is what /a/<id>/raw returns for markup — served TOP-LEVEL to a
 * reader (proxy.ts) and as the owner's sandboxed iframe src — and the response
 * headers on that route are the security policy; this module is the bytes.
 *
 * Assembly:
 *   <head>  charset · <title> (Helmet title ▸ stored title) · compiled Tailwind
 *           sheet · bare-typography floor · platform fonts · the author's
 *           Helmet <style> (last, so custom CSS sees everything it may override;
 *           compiled utilities stay !important on this tier regardless)
 *   <body>  SSR of the body nodes via StoryRuntimeApp (the SAME component the
 *           runtime hydrates — hydration matches by construction) · the JSON
 *           data island · the runtime <script type=module src> (crossorigin,
 *           so its lazy chunks resolve from an opaque origin) · the author's
 *           Helmet <script>, parked inert (AUTHOR_SCRIPT_TYPE) for the runtime
 *           to re-inject after hydration — or run inline when there is no
 *           runtime, since the document is already complete.
 *
 * Render trusts canonical stored source (validation happened at the door), with
 * two belts mirroring the interpreter's defense-in-depth stance: source that no
 * longer parses renders as escaped text (never mangled), and a script that
 * somehow carries `</script` is DROPPED — emitting it would let text escape the
 * script element, and mutating code silently is worse than omitting it.
 */
import path from 'path';
import { pathToFileURL } from 'url';
import { createRequire } from 'module';
import { IS_DEV } from '@/lib/config';
import { EMPTY_HELMET_CONTENT, type HelmetContent } from '@/lib/story/helmet';
import { storyBodyFor } from '@/lib/story/body';
import { assetLookupFrom, type WebAssetBox } from '@/lib/story/asset-url';
import { AUTHOR_SCRIPT_TYPE, STORY_HELLO_MESSAGE, STORY_VALUES_HOOK, STORY_ISLAND_ID, STORY_PAINTED_MESSAGE, STORY_ROOT_ID, type StoryIslandData, type StoryIslandDataflow, type StorySsrBundle } from '@/lib/story-runtime/contract';
import type { JsxNode } from '@/lib/jsx';
import type { RefDataMap } from '@/lib/story/ref-data';
import { STORY_CHROME_CSS, STORY_COLUMN_CSS, STORY_EMBED_CSS, STORY_TABLE_CSS } from '@/lib/story-runtime/chrome-css';
import { STORY_BARE_TYPOGRAPHY_CSS } from '@/lib/story-surface/bare-typography';
import { STORY_ROOT_ATTR } from '@/lib/story-surface';
import { escapeHtml, renderReaderChrome, type ReaderForkedFrom, type ReaderReactions } from '@/lib/story/reader-chrome';
import { criticalStoryFonts, getStoryFontCss, storyFontFaceCss, STORY_FONTS_ATTR } from '@/lib/data/story/story-fonts';
import { documentFonts, documentFontCss } from './document-fonts';
import { webFontAssets } from '@/lib/webfonts';
import { resolveStoryMode } from '@/lib/data/story/story-themes';
import type { StoryThemeName } from '@/lib/validation/atlas-schemas';

export interface StoryDocumentInput {
  source: string;
  compiledCss: string | null;
  theme: StoryThemeName | null;
  /** Stored structural genre; only editorial documents are eligible for a Contents rail. */
  template?: string | null;
  colorMode: 'light' | 'dark' | null;
  /** Server-resolved `ref:` data — rendered in; the sandbox reaches no third party (its only fetch is its own query url). */
  refData: RefDataMap;
  /**
   * The web URLs we hold a copy of (lib/web-assets), as a Set or as the rows
   * themselves — a row additionally carries the box and the blur, which is what
   * keeps a URL-kept image from shifting the page as it lands. Absent means map
   * nothing: a caller with no index serves the document exactly as it is stored.
   */
  assetUrls?: ReadonlySet<string> | ReadonlyMap<string, WebAssetBox>;
  /** The document's `<Value>`/`<Query>`/`<Mutation>` declarations + render-time state (lib/artifacts dataflowForRow); null when it declares nothing. */
  dataflow?: StoryIslandDataflow | null;
  /** Stored title (Helmet's own <title> wins over it in the head). */
  title: string | null;
  /** src of the hydration runtime; null omits the tag (unit tests, scriptless contexts). */
  runtimeSrc?: string | null;
  /**
   * The reading-position script (lib/story-runtime/anchor-entry), which EVERY
   * document loads — the ones that hydrate nothing have readers with a place in
   * them too. ~1.5 KB, no React.
   */
  anchorSrc?: string | null;
  /**
   * The COMMENT layer (lib/story-runtime/comment-entry) — the frame half of
   * annotating without the hydration runtime around it. Used only when the
   * document would otherwise ship no runtime at all; one that hydrates already
   * carries the annotate chunk.
   */
  commentSrc?: string | null;
  /**
   * What this document needs to hear its own author: its id and the version it
   * is showing (lib/story-runtime/live-entry). Absent for a CAPTURE — a
   * screenshot has no reader to keep up to date, and an exporter that adopted
   * an edit mid-shot would photograph two documents at once.
   */
  live?: { id: string; editId: string } | null;
  /**
   * The runtime's lazy chunks (lib/story/runtime-asset) — preloaded, but only
   * by a document that will actually reach for one. See {@link drawsChart}.
   */
  lazyChunks?: string[] | null;
  /**
   * Where an AGENT that fetched this document learns how to edit it (discover): rendered as
   * `<link rel="help" href={docs} title="…">` and `<meta name="artifactbin:agent" content="To edit this artifact with an agent,
   * read {docs} — tokens at {tokens}">` in <head>, right after the platform's social tags. Null/absent ⇒ nothing.
   */
  help?: { docs: string; tokens: string } | null;
  /**
   * The document's own query endpoint (lib/story-runtime/contract
   * StoryIslandData.queryUrl) — set by the serving route; absent for renders
   * that never re-run (the canvas, unit tests).
   */
  queryUrl?: string | null;
  /**
   * The document's own WRITE endpoint (StoryIslandData.mutateUrl) — set by the
   * serving route for a document that declares a `<Mutation>`; absent
   * everywhere a write cannot happen (the canvas, a capture, unit tests).
   */
  mutateUrl?: string | null;
  /**
   * The document's own ASSET IMPORT endpoint (StoryIslandData.assetsUrl) — set
   * by the serving route, so a bound `<img src="$pick">` has somewhere to
   * import the URL a reader picks. Absent for renders with no reader behind
   * them (the canvas, unit tests), where a bound image renders static.
   */
  assetsUrl?: string | null;
  /**
   * Render the document's own navigation chrome (deck rail, present bar, outline).
   * False for capture renders — /export screenshots this frame, so chrome
   * would appear in every OG card and share image. Default true.
   */
  chrome?: boolean;
  /**
   * Ship the runtime even for a document that would not otherwise hydrate.
   *
   * A document of pure prose has nothing to hydrate, so it ships no runtime —
   * and in-place editing IS the runtime (lib/story-runtime/edit). The owner's
   * copy therefore asks for it up front: pressing edit then costs one message
   * rather than a reload, and a reader's copy stays exactly as lean as it was.
   */
  editable?: boolean;
  /**
   * `?comment=1` — this viewer may COMMENT but not edit. It buys the comment
   * layer, never the editor: 13 KB against 384 KB, on documents of prose where
   * the runtime would otherwise be downloaded to draw a tint.
   */
  commenting?: boolean;
  /**
   * WHO MADE IT and WHERE IT CAME FROM, for the reader chrome
   * (lib/story/reader-chrome): the author's handle is the byline and
   * `forkedFrom` is PROVENANCE, shown in the settings panel — resolved per
   * render rather than written into the markup, so an agent that regenerates
   * the document cannot delete the attribution, and nothing about the source
   * is baked into bytes that outlive its ACL. The ROUTE decides both fields —
   * it holds the rows — and anything that is not a PUBLIC source produces a
   * label with NO href and no id, identical for unlisted, private and deleted:
   * one branch, so the line can be neither an existence oracle nor a listing
   * surface for a tier whose whole point is being listed nowhere.
   *
   * Null/absent for a capture. `username: null` is an anonymous document: the
   * chrome then carries no author mark at all.
   */
  author?: { username: string | null; forkedFrom?: ReaderForkedFrom | null } | null;
  /**
   * Link-unfurl cards for THIS document. A reader is served the document
   * itself rather than the app page, so if these are not in its head a shared
   * link unfurls as a bare URL — crawlers do not run JavaScript. Absent on a
   * capture render, which is the exporter photographing this very frame.
   */
  social?: { title: string; description: string | null; image: string } | null;
  /**
   * THE WAY IN, for a guest whose link grants more than the anonymous ceiling
   * lets them use (lib/share-roles roleBehindLogin). The ROUTE decides this —
   * it holds the viewer and the row — and the builder only says it, so the
   * document module never grows an opinion about the ACL.
   *
   * Absent for anyone with an account (nothing is being withheld from them),
   * for a viewer-only link, and for a capture: /export photographs this frame.
   */
  signIn?: { unlocks: 'commenter' | 'editor'; callbackUrl: string } | null;
  /**
   * "make this mine", in the reader's own controls. Unlike {@link signIn} it is
   * offered on EVERY chrome-bearing markup document, because a reader may fork
   * anything they can read and the door agrees (it decides on the read ACL).
   *
   * An anchor and nothing else, for the reason the sign-in door is one: the
   * document is sandboxed with an opaque origin and holds no session, so it
   * cannot POST the fork itself. It carries the ASK, and the shell on the
   * other side performs it — which is why the ROUTE decides where it points
   * (login-and-back for a request with no viewer, the document itself for one
   * with).
   */
  fork?: { href: string } | null;
  /** "Sign in" in the profile menu, for a reader with no session (the route knows). */
  login?: { href: string } | null;
  /** The rail offers Edit: this is a writer's framed copy (`?edit=1`). */
  edit?: boolean;
  /** The owner sees the artifact title beside the handle as a breadcrumb. */
  ownerBreadcrumb?: boolean;
  /** Like and follow counts, this viewer's own state, and the doors (lib/story/reader-chrome ReaderReactions). */
  reactions?: ReaderReactions | null;
}

/**
 * The SSR renderer is a PREBUILT esbuild bundle (scripts/build-story-runtime.mjs
 * → lib/story-runtime/dist/story-ssr.cjs), required dynamically so the Next
 * compiler never walks into it: route handlers compile under the react-server
 * condition, which forbids the client-React APIs the kit uses. The bundle
 * carries its own full React and speaks plain data across the boundary
 * (nodes + refData in, an HTML string out).
 */
// createRequire is the one loader neither Turbopack nor Vitest intercepts —
// the specifier resolves at runtime, from disk, on the server. (Sanctioned
// dynamic import, like lib/db.ts's engine pick.)
let ssrBundle: StorySsrBundle | null = null;
function loadSsrBundle(): StorySsrBundle {
  const req = createRequire(pathToFileURL(path.join(process.cwd(), 'package.json')).href);
  const file = path.join(process.cwd(), 'lib', 'story-runtime', 'dist', 'story-ssr.cjs');
  // In DEV the bundle is rebuilt under the running server, so a cached copy
  // would render markup from before the rebuild while the browser loads the
  // new client half — a hydration mismatch manufactured by the dev loop.
  if (IS_DEV) delete req.cache[req.resolve(file)];
  else if (ssrBundle) return ssrBundle;
  const loaded = req(file) as StorySsrBundle;
  if (!IS_DEV) ssrBundle = loaded;
  return loaded;
}

/**
 * Does this document need the runtime at all?
 *
 * Only components hydrate — tabs open, charts draw, a rail navigates. A
 * document of plain HTML tags is FINISHED once its markup is parsed, and
 * shipping it ~600 KB of JavaScript to do nothing is the difference between a
 * prose page that costs one request and one that costs two and a bundle.
 */
function needsRuntime(nodes: JsxNode[]): boolean {
  return nodes.some((n) =>
    n.type === 'element' && (n.isComponent || needsRuntime(n.children)));
}

/** The `viz.kind`s whose branch in QuestionEmbed reaches the lazy chart module. */
const CHART_VIZ_KINDS = new Set(['vega', 'vega-lite', 'recipe']);

/**
 * Will this document import the chart bundle?
 *
 * Only `<Question>` does, and only for the kinds above: a question with no
 * `viz`, or one whose kind is `table` or `single_value`, renders inline and
 * never touches it. That distinction is the whole reason the chunk is split
 * out, so the preload has to respect it or a prose document with one summary
 * number pays ~830 KB for nothing.
 */
function drawsChart(nodes: JsxNode[]): boolean {
  return nodes.some((n) => {
    if (n.type !== 'element') return false;
    if (n.isComponent && n.tag === 'Question') {
      const viz = n.attributes.find((a) => a.name === 'viz')?.value;
      const kind = viz?.static && viz.json && typeof viz.json === 'object' && !Array.isArray(viz.json)
        ? viz.json.kind : null;
      if (typeof kind === 'string' && CHART_VIZ_KINDS.has(kind)) return true;
    }
    return drawsChart(n.children);
  });
}


/**
 * The URL bar is ours, not the document's.
 *
 * Served top-level (the reader path), an author's script shares a browsing
 * context with the URL a reader is looking at — so `history.replaceState`
 * could paint `/login`, or any other path under our host, over a page the
 * author controls completely. Overriding and FREEZING the History API before
 * the author's script runs closes that: inside the sandbox the usual escape
 * (borrowing a pristine prototype from a fresh `about:blank` realm) fails,
 * because a child frame inherits the sandbox flags and gets its OWN opaque
 * origin, which makes it cross-origin to its parent.
 *
 * Deliberately narrow. `location` is [LegacyUnforgeable] — every property
 * non-configurable, nothing able to shadow it — so a script can still navigate
 * the tab away, with `<meta http-equiv=refresh>` as a second route. This is
 * about the URL bar LYING, not about where a click may lead.
 *
 * Safe for our own document: the runtime never calls either method (pinned by
 * lib/story/__tests__/history-prelude.test.ts), and hydration does not route.
 */
/*
 * SPIKE S2 (F2 — the reader's `<Value>` selections in the URL, risk R5).
 *
 * The freeze above is exactly what a reader-facing URL needs, and F2 needs the
 * URL to change anyway: someone who picks "west" must be able to copy the
 * address bar and hand another person the document they are looking at. So the
 * prelude keeps every door shut and opens ONE WINDOW, `window.__mxValues`.
 *
 * It is narrow by CONSTRUCTION, not by escaping:
 *  - it holds the NATIVE `replaceState`, bound before the overwrite below —
 *    after the freeze there is no other way to reach it, in or out;
 *  - it takes no path, no host and no hash. `location.pathname` and
 *    `location.hash` are read FRESH at call time, so there is no argument for
 *    a crafted `toString` to arrive through;
 *  - a key that is not a plain value name (`/^[A-Za-z_]\w*$/`, the dataflow's
 *    own shape) is DROPPED rather than encoded, and only the object's own
 *    enumerable keys are read, so a polluted `Object.prototype` injects
 *    nothing;
 *  - the search is rebuilt from `URLSearchParams`, so every value is encoded
 *    and a `#` or `&` inside one is a character, never a delimiter. `$` alone
 *    is written back literally — it is a legal query character and the point
 *    of the whole feature is a link a person can read.
 * A frozen, non-writable, non-configurable own property, so the author's own
 * script cannot replace it with something that lies about what it did.
 */
export const HISTORY_PRELUDE =
  '(function(){var b=function(){};try{'
  /*
   * ORDER IS THE WHOLE MECHANISM, and it runs in exactly two beats.
   *
   * FIRST, bind the native — after the overwrite below there is no way to
   * reach it, in or out, which is the point.
   *
   * THEN shut every door, and only AFTER that build the capability. The
   * capability's own statements sit inside the same fail-silent `try`, so
   * anything that throws there (a `defineProperty` refused because something
   * already owns the name) would take the FREEZE down with it and leave the
   * document with a fully writable History API and nobody told. The freeze is
   * what this prelude is FOR; nothing may be attempted in front of it.
   */
  + 'var n=history.replaceState.bind(history);'
  + 'history.pushState=b;history.replaceState=b;'
  + 'History.prototype.pushState=b;History.prototype.replaceState=b;'
  + 'Object.freeze(History.prototype);Object.freeze(history);'
  + 'var c=function(s){return encodeURIComponent(s).replace(/%24/g,"$")};'
  + 'var f=function(v){try{'
  + 'if(!v||typeof v!=="object")return;'
  + 'var p=new URLSearchParams(location.search),k=Object.keys(v),i,m,x;'
  + 'for(i=0;i<k.length;i++){m=k[i];'
  + 'if(!/^[A-Za-z_][A-Za-z0-9_]*$/.test(m))continue;'
  // `x==null` rather than a spelled-out `undefined`: the built document is
  // guarded against emitting that token at all (__tests__/document.test.ts).
  + 'x=v[m];if(x==null)p.delete("$"+m);else p.set("$"+m,""+x)}'
  + 'var o=[];p.forEach(function(val,key){o.push(c(key)+"="+c(val))});'
  + 'var q=o.join("&");'
  + 'n(null,"",location.pathname+(q?"?"+q:"")+location.hash)'
  + '}catch(g){}};'
  + 'Object.freeze(f);'
  + `Object.defineProperty(window,"${STORY_VALUES_HOOK}",{value:f,writable:false,configurable:false,enumerable:false});`
  + '}catch(z){}})()';

/**
 * Re-apply the READER's mode override before first paint. The override lives
 * in the `mx:doc:` window.name envelope (lib/story-runtime/reader-mode) —
 * an opaque origin has no storage — and a no-runtime document delivers live
 * edits by reloading itself, so without this the reload flashes the author's
 * mode before anchor-entry gets to run. Inline, tiny, fail-silent.
 */
const MODE_PRELUDE =
  '(function(){try{var r=document.documentElement;if(parent!==window)r.classList.add("mx-framed");'
  + 'var n=window.name||"";if(n.indexOf("mx:doc:")!==0)return;'
  + 'var s=JSON.parse(n.slice(7));if(!s||(s.mode!=="dark"&&s.mode!=="light"))return;'
  + 'var c=r.classList;'
  + 'c.toggle("dark",s.mode==="dark");c.toggle("light",s.mode!=="dark");'
  + '}catch(e){}})()';

/** `</style` inside CSS would close the tag early; CSS has no use for the sequence. */
const styleTag = (attr: string, css: string): string =>
  `<style ${attr}>${css.replace(/<\/style/gi, '')}</style>`;

export async function buildStoryDocument(input: StoryDocumentInput): Promise<string> {
  const { source, compiledCss, theme, template = null, colorMode, refData, runtimeSrc, anchorSrc, commentSrc, live = null, chrome = true, social = null, help = null, signIn = null, fork = null } = input;
  const dataflow = input.dataflow ?? null;

  /*
   * ONE tree for every rendering (lib/story/body): the nesting repair the HTML
   * parser would otherwise undo, the Helmet split, and the serve-time asset
   * mapping, in that order and in one place.
   *
   * It has to happen ABOVE the split rather than in either renderer:
   * `split.body` feeds both the SSR string and the island the client hydrates
   * FROM — and, through them, the renderer's own `<link rel=preload as=image>`
   * — and the whole failure is those disagreeing. The live frame
   * (lib/story/update-parts) is built from the same function for the same
   * reason: a reader watching an agent write must be adopting the document a
   * reload would give them.
   */
  const split = storyBodyFor(source, input.assetUrls ? assetLookupFrom(input.assetUrls) : undefined, { capture: !chrome });
  const helmet: HelmetContent = split?.content ?? EMPTY_HELMET_CONTENT;

  // Mode resolution lives HERE, for every reader: a theme is designed for
  // one mode and wins; colorMode decides unthemed documents. The edit canvas
  // resolves it the same way (JsxArtifactEditor), which is what keeps a
  // document from being edited in a mode it will never be read in.
  const mode = resolveStoryMode(theme, colorMode);
  const title = helmet.title?.trim() || input.title || 'artifact';

  /*
   * THE READER'S CHROME (lib/story/reader-chrome) — assembled here and dropped
   * after the story root below. Chrome-less documents are CAPTURE inputs, so
   * the omission is structural: /export photographs this frame, and neither the
   * rail nor the attribution belongs in an unfurl card.
   */
  const readerChrome = chrome
    ? renderReaderChrome({
      // The document knows its own id only when it is live enough to hear its
      // author; a capture and a unit render have none, and the like/comment
      // log then names nothing rather than guessing.
      artifactId: live?.id ?? null,
      // The STORED title, never the Helmet's: the Helmet is head content and
      // nothing of it may reach the body (a rule this file already lives by),
      // and "artifact" is a placeholder for a tab rather than a claim to print
      // beside the author's handle.
      title: input.title ?? null,
      author: input.author ?? null,
      signIn,
      fork,
      login: input.login ?? null,
      edit: !!input.edit,
      ownerBreadcrumb: input.ownerBreadcrumb,
      reactions: input.reactions ?? null,
    })
    : '';

  /*
   * Resolved ONCE and handed to both the SSR render and the island below: the
   * two are compared by React at hydration, so a second resolution — or one of
   * them missing — is a mismatch. Empty for a document that draws no icons,
   * which is 153 of the 155 on production.
   */
  const glyphs = split ? loadSsrBundle().glyphsForNodes(split.body) : {};

  /*
   * The SSR string and the island below are built from SEPARATE prop lists, and
   * an island field that CHANGES WHAT IS DRAWN must appear in both or React
   * discards the whole server tree at hydration (#418). `assetsUrl` was the
   * first such field — `queryUrl`/`mutateUrl` only name a transport, so their
   * absence here is correct, while a bound `<img src="$pick">` has nowhere to
   * import from without this and rendered as a bare alt until hydration.
   */
  const bodyHtml = split
    ? loadSsrBundle().renderStoryBody({ nodes: split.body, refData, glyphs, ...(dataflow ? { dataflow } : {}), colorMode: mode, template, chrome, ...(input.assetsUrl ? { assetsUrl: input.assetsUrl } : {}) })
    : `<pre>${escapeHtml(source)}</pre>`;

  // Style order mirrors the engine's injection order (compiled Tailwind → bare
  // typography floor → fonts), author CSS last so it sees everything it may
  // override. `--mx-vh` feeds the recipes that size against the host viewport
  // (slides); the served document owns its own window, so 100vh is exact.
  // Discovery at parse time, inside the document that actually paints in these
  // faces. The parent page cannot preload for a framed copy: the frame has an
  // OPAQUE origin, so its font fetch is cross-origin (hence `crossorigin`, and
  // the ACAO header on /fonts in services/app/server/app.ts) and lands in its own cache
  // partition — a parent preload would warm an entry nothing here can use.
  // The families this document ASKED for (Helmet meta), already resolved and
  // copied at publish (lib/webfonts) — served from this origin like a bundled
  // face, and preloaded on the same rule (the latin upright only).
  const docFonts = documentFonts(helmet);
  const importedFaces = docFonts.families.length > 0 ? await webFontAssets(docFonts.families) : [];
  const fontPreloads = [...criticalStoryFonts(theme ?? undefined), ...importedFaces.filter((f) => f.preload)]
    .map((f) => `<link rel="preload" href="${escapeHtml(f.url)}" as="font" type="font/woff2" crossorigin>`)
    .join('');

  const styles = [
    '<style>:root { --mx-vh: 100vh; } body { margin: 0; }</style>',
    compiledCss ? styleTag('data-mx-tw', compiledCss) : '',
    styleTag('data-mx-bare-type', STORY_BARE_TYPOGRAPHY_CSS),
    chrome ? styleTag('data-mx-chrome', STORY_CHROME_CSS) : '',
    styleTag('data-mx-embed', STORY_EMBED_CSS),
    // Every table its own scroll box, every document, capture included: a
    // table is a table either way (lib/story-runtime/chrome-css STORY_TABLE_CSS).
    styleTag('data-mx-tables', STORY_TABLE_CSS),
    // The column the document is measured in — capture included, for the same
    // reason (STORY_COLUMN_CSS): it decides what the authored `@container`
    // utilities resolve against, so a capture without it lays out differently.
    styleTag('data-mx-column', STORY_COLUMN_CSS),
    styleTag(STORY_FONTS_ATTR, getStoryFontCss(theme ?? undefined)),
    // Imported faces and the slot override LAST among the font styles: the
    // document's own ask beats the theme it otherwise keeps entirely.
    importedFaces.length ? styleTag('data-mx-webfonts', storyFontFaceCss(importedFaces)) : '',
    documentFontCss(docFonts) ? styleTag('data-mx-font-vars', documentFontCss(docFonts)) : '',
    helmet.style ? styleTag('data-mx-author', helmet.style) : '',
  ].join('');

  // A document with no components has nothing to hydrate (see needsRuntime) —
  // unless it declares data: a `$`-bound native control is live only with the
  // runtime's store behind it, component or not.
  /*
   * A commenter with NO comment bundle falls back to the runtime — which is
   * exactly what they were served before this existed. The manifest field is
   * additive (lib/story/runtime-asset), so a deploy whose runtime predates it
   * must degrade to the old, heavy, WORKING delivery rather than to silence.
   */
  const commentFallback = !!input.commenting && !commentSrc;
  const hydrates = !!split && !!runtimeSrc && (needsRuntime(split.body) || !!dataflow || !!input.editable || commentFallback);
  /*
   * The THIRD delivery: comments without hydration. A commenter's frame used
   * to ask for `?edit=1` — which made this `hydrates` — so a page of prose
   * downloaded the entire runtime in order to tint a paragraph. This is the
   * same frame half at 1/29th the bytes.
   *
   * Only when the document would ship NOTHING otherwise: one that hydrates
   * already reaches the annotate chunk through its runtime, and two annotate
   * sessions on one document would fight over the same nodes.
   */
  const comments = !hydrates && !!split && !!commentSrc && !!input.commenting;
  /** Either delivery needs the parsed body — the comment layer classifies selections against it. */
  const carriesIsland = hydrates || comments;

  /*
   * Asked for in the head, so the browser fetches them alongside the styles and
   * the fonts instead of discovering them one at a time: the runtime is not
   * named until the document has arrived, and its chart chunk not until the
   * runtime has downloaded AND parsed — three requests, each waiting on the
   * last, which is most of what a reader experiences as the document being slow.
   *
   * `crossorigin` is the same load-bearing flag the script tag carries and for
   * the same reason (an opaque origin makes these fetches cross-origin); it
   * must MATCH, or the preload warms an entry the script cannot use and the
   * bytes are fetched twice. Fonts stay first: they block the text.
   */
  const modulePreloads = [
    // FIRST, and unconditional: the anchor module is the reader's OWN chrome —
    // the phone bar's scroll relay, the outline's clicks, the scroll-marked
    // tables — and it is ~8 KB. Asking for it after a megabyte of runtime, or
    // only for documents that hydrate, gets that backwards: the document that
    // gains most is the prose one that ships nothing else.
    ...(anchorSrc ? [anchorSrc] : []),
    ...(hydrates ? [runtimeSrc!, ...(drawsChart(split!.body) ? input.lazyChunks ?? [] : [])] : []),
  ].map((href) => `<link rel="modulepreload" href="${escapeHtml(href)}" crossorigin>`).join('');

  const island: StoryIslandData = { nodes: split?.body ?? [], refData, ...(Object.keys(glyphs).length ? { glyphs } : {}), ...(dataflow ? { dataflow } : {}), colorMode: mode, template, chrome, ...(input.queryUrl ? { queryUrl: input.queryUrl } : {}), ...(input.mutateUrl ? { mutateUrl: input.mutateUrl } : {}), ...(input.assetsUrl ? { assetsUrl: input.assetsUrl } : {}) };
  // `<` escaped so no row value can close the script element from inside JSON.
  const islandJson = JSON.stringify(island).replace(/</g, '\\u003c');

  /**
   * The author's script — dropped outright if it could escape its element
   * (the belt mirroring the door's check).
   *
   * With a runtime it is PARKED for the runtime to inject after hydration: a
   * deferred module would otherwise let it run against an unhydrated tree.
   * With no runtime there is nothing to wait for, so it runs inline at parse
   * time, which is also when the document is complete.
   */
  const safeScript = helmet.script && !/<\/script/i.test(helmet.script) ? helmet.script : null;
  const authorScript = safeScript
    ? (hydrates ? `<script type="${AUTHOR_SCRIPT_TYPE}">${safeScript}</script>` : `<script>${safeScript}</script>`)
    : '';

  return (
    /*
     * `data-theme` goes on the DOCUMENT ELEMENT, not the body: the theme sheet
     * is written against `:root:where(:is([data-theme="…"]))`
     * (lib/data/story/story-themes.ts), which supplies --font-body,
     * --font-display and --background. On <body> that selector matches
     * nothing, and the document silently loses its typography and ground —
     * headings fall back to the generic sans stack and the platform face is
     * never requested at all.
     */
    `<!DOCTYPE html><html class="${mode}"${theme ? ` data-theme="${escapeHtml(theme)}"` : ''}>` +
    `<head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width, initial-scale=1">` +
    `<base target="_top">` +
    `<title>${escapeHtml(title)}</title>` +
    helmet.meta.map((m) => `<meta name="${escapeHtml(m.name)}" content="${escapeHtml(m.content)}">`).join('') +
    // The author's own <meta> comes first, so a document that declares its own
    // description keeps it; these add what only the platform knows.
    (social
      ? `<meta property="og:title" content="${escapeHtml(social.title)}">`
        + (social.description ? `<meta property="og:description" content="${escapeHtml(social.description)}">` : '')
        + `<meta property="og:image" content="${escapeHtml(social.image)}">`
        + '<meta name="twitter:card" content="summary_large_image">'
      : '') +
    (help
      ? `<link rel="help" href="${escapeHtml(help.docs)}" title="Agents: read this first to edit any artifact here">`
        + `<meta name="artifactbin:agent" content="To edit this artifact with an agent, read ${escapeHtml(help.docs)} — tokens at ${escapeHtml(help.tokens)}">`
      : '') +
    // First script in the document: the author's runs at the end of <body>,
    // and anything that could hand the URL bar away must already be closed.
    `<script>${HISTORY_PRELUDE}</script>` +
    // Before any paint: a persisted reader mode override replaces the class
    // the server stamped, so a live reload never flashes the author's mode.
    // Chrome-gated with the toggle itself — a capture must render the stored
    // design exactly.
    (chrome ? `<script>${MODE_PRELUDE}</script>` : '') +
    `${fontPreloads}${modulePreloads}${styles}</head>` +
    // The live attributes are what the reading-position module reads to open
    // this document's own stream (lib/story-runtime/anchor-entry).
    `<body ${STORY_ROOT_ATTR}${live ? ` data-mx-live-id="${escapeHtml(live.id)}" data-mx-live-edit="${escapeHtml(live.editId)}"` : ''}>` +
    `<div id="${STORY_ROOT_ID}">${bodyHtml}</div>` +
    readerChrome +
    /*
     * The page holds its own copy of this text until we say we have painted,
     * and parse time IS the paint: everything above is server-rendered markup.
     *
     * Announced REPEATEDLY, not once. The page's own JavaScript may not have
     * hydrated yet when this runs — on a slow link it usually has not — and a
     * single post into a page with no listener yet is simply lost, leaving the
     * reader on the fallback for as long as the browser takes to fire `load`.
     * A few cheap repeats cost nothing and cannot be missed.
     *
     * AND IT BROADCASTS, deliberately — the one message in the document that
     * still does. Everything the RUNTIME sends is addressed to the app's own
     * origin (lib/story-runtime/pristine), which it learns from its own module
     * URL, so it tracks whatever host the reader actually used. This script
     * runs BEFORE that module — that is its whole job, a document that never
     * loads its runtime still says it painted — so the only origin available
     * to it is one baked in server-side. That would be wrong for a box serving
     * two hostnames: the page would never hear `mx:painted` and an owner would
     * watch the loading indicator forever. Broadcast is safe here because the
     * message is a CONSTANT: it tells a listener the frame painted, which is
     * something anyone framing this document can already see.
     */
    `<script>(function(){var m=${JSON.stringify(STORY_PAINTED_MESSAGE)},`
      + `h=${JSON.stringify(STORY_HELLO_MESSAGE)},n=0,`
      + `t=setInterval(function(){parent.postMessage(m,'*');if(++n>20)clearInterval(t)},150);`
      + `parent.postMessage(m,'*');addEventListener('load',function(){parent.postMessage(m,'*')});`
      // The burst above has an end; this does not. A page that hydrates after
      // it asks, and gets its answer whenever that happens.
      + `addEventListener('message',function(e){if(e.data===h)parent.postMessage(m,'*')})})()</script>` +
    (carriesIsland ? `<script type="application/json" id="${STORY_ISLAND_ID}">${islandJson}</script>` : '') +
    // A module, because the bundle is code-split. `crossorigin` is load-bearing,
    // not hygiene: this document has an OPAQUE origin, so without it the browser
    // gives the script `about:blank` as its base URL — every dynamic import()
    // inside it (the lazy chart module) then fails to resolve — and the entry
    // and its lazy chunks are blocked outright. Fetching in CORS mode (with
    // ACAO on the asset, see services/app/server/app.ts) gives it its real URL as the base.
    (hydrates ? `<script type="module" src="${escapeHtml(runtimeSrc!)}" crossorigin></script>` : '') +
    // The comment layer stands in for the runtime, never beside it.
    (comments ? `<script type="module" src="${escapeHtml(commentSrc!)}" crossorigin></script>` : '') +
    // Unconditional, unlike the runtime above: keeping the reader's place is
    // not a feature of documents that happen to hydrate.
    /*
     * ASYNC, alone among the three. A module script without it executes IN
     * ORDER with every module script before it, so on a chart document this
     * one waited for the whole runtime entry to download AND evaluate before
     * the reader's bar would answer a single scroll — measured at ~9.3 s
     * against ~2.0 s for the chrome appearing (scripts/measure-bar.mjs).
     * Nothing here depends on the runtime or on anything the runtime does, so
     * there is no order to keep; it needs only its own document, and it is
     * emitted after the island for that.
     */
    (anchorSrc ? `<script type="module" src="${escapeHtml(anchorSrc)}" crossorigin async></script>` : '') +
    authorScript +
    `</body></html>`
  );
}
