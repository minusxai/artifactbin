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
import { parseJsx } from '@/lib/jsx';
import { EMPTY_HELMET_CONTENT, splitHelmet, type HelmetContent } from '@/lib/story/helmet';
import { fixHtmlNesting } from '@/lib/story/nesting';
import { AUTHOR_SCRIPT_TYPE, STORY_HELLO_MESSAGE, STORY_VALUES_HOOK, STORY_ISLAND_ID, STORY_PAINTED_MESSAGE, STORY_ROOT_ID, type StoryIslandData, type StoryIslandDataflow, type StorySsrBundle } from '@/lib/story-runtime/contract';
import type { JsxNode } from '@/lib/jsx';
import type { RefDataMap } from '@/lib/story/ref-data';
import { STORY_CHROME_CSS, STORY_COLUMN_CSS, STORY_EMBED_CSS, STORY_TABLE_CSS } from '@/lib/story-runtime/chrome-css';
import { STORY_BARE_TYPOGRAPHY_CSS } from '@/lib/story-surface/bare-typography';
import { STORY_ROOT_ATTR } from '@/lib/story-surface';
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
   * Platform attribution appended after the artifact; null/absent for exports.
   *
   * `forkedFrom` is PROVENANCE, resolved per render rather than written into
   * the markup: an agent that regenerates the document cannot delete the
   * attribution, and nothing about the source is baked into bytes that outlive
   * its ACL. The ROUTE decides both fields — it holds the rows — and anything
   * that is not a PUBLIC source produces a label with NO href and no id,
   * identical for unlisted, private and deleted: one branch, so the line can be
   * neither an existence oracle nor a listing surface for a tier whose whole
   * point is being listed nowhere.
   */
  credits?: {
    creatorUsername: string | null;
    forkedFrom?: { label: string; href: string | null } | null;
  } | null;
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

/**
 * The anonymous reader's page chrome. It mirrors the trusted parent shell's
 * Menu / Home / Controls rail, but contains only what an opaque top-level
 * document may safely do: navigate and change its own reading appearance. A
 * framed owner/editor copy hides this layer; authenticated document actions
 * stay in the parent that holds the session.
 */
const ICON_MENU = '<svg class="mx-rc-open" viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16"/></svg>';
const ICON_HOME = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m3 11 9-8 9 8"/><path d="M5 10v10h14V10M9 20v-6h6v6"/></svg>';
const ICON_SLIDERS = '<svg class="mx-rc-open" viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/></svg>';
const ICON_X = '<svg class="mx-rc-close" viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><path d="m18 6-12 12M6 6l12 12"/></svg>';
const ICON_SUN = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>';
const ICON_MOON = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';

/**
 * The DOOR, in the artifact controls beside appearance — because "log in to
 * comment on THIS" is a fact about this artifact, where the left menu is app
 * navigation. Rendered only when signing in would actually change what the
 * holder may do (lib/share-roles roleBehindLogin), so an ordinary public link
 * looks exactly as it always has.
 *
 * An anchor and nothing else: no runtime, no fetch, no session in an opaque
 * document. `target="_top"` is what makes it work at all — the document is
 * sandboxed without allow-same-origin, and a user-activated top navigation is
 * the one way out it has (the menu's own links have always used it).
 */
const SIGN_IN_LABEL: Record<'commenter' | 'editor', string> = {
  commenter: 'log in to comment',
  editor: 'log in to edit',
};

/**
 * FORK, beside the sign-in door and for the same structural reason: an opaque
 * document cannot act, so it carries the ask and the app performs it.
 * `target="_top"` is what makes it work — a sandboxed document's one way out
 * is a user-activated top navigation.
 */
const FORK_LABEL = 'Fork artifact';
const ICON_FORK = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><circle cx="18" cy="6" r="3"/><path d="M18 9v2c0 .6-.4 1-1 1H7c-.6 0-1-.4-1-1V9"/><path d="M12 12v3"/></svg>';

const renderFork = (fork: NonNullable<StoryDocumentInput['fork']>): string =>
  `<a class="mx-reader-signin" data-mx-fork href="${escapeHtml(fork.href)}"`
  + ` target="_top" aria-label="${FORK_LABEL}">${ICON_FORK}fork</a>`;

const renderSignIn = (signIn: NonNullable<StoryDocumentInput['signIn']>): string =>
  `<a class="mx-reader-signin" data-mx-signin href="/login?callbackUrl=${escapeHtml(encodeURIComponent(signIn.callbackUrl))}"`
  + ` target="_top" aria-label="${escapeHtml(SIGN_IN_LABEL[signIn.unlocks])}">${escapeHtml(SIGN_IN_LABEL[signIn.unlocks])}</a>`;

const renderReaderChrome = (signIn?: StoryDocumentInput['signIn'], fork?: StoryDocumentInput['fork']): string =>
  '<div class="mx-reader-chrome" data-mx-reader-chrome>'
  + `<button type="button" class="mx-reader-trigger mx-reader-trigger--left" data-mx-reader-trigger="menu" aria-label="Open menu" aria-expanded="false">${ICON_MENU}${ICON_X}<span class="mx-reader-label" data-mobile-label>menu</span></button>`
  + `<a class="mx-reader-home" href="/" target="_top" aria-label="Home">${ICON_HOME}<span class="mx-reader-label" data-mobile-label>home</span></a>`
  + `<button type="button" class="mx-reader-trigger mx-reader-trigger--right" data-mx-reader-trigger="controls" aria-label="Open artifact controls" aria-expanded="false">${ICON_SLIDERS}${ICON_X}<span class="mx-reader-label" data-mobile-label>controls</span></button>`
  + '<button type="button" class="mx-reader-scrim" data-mx-reader-scrim aria-label="Close page controls" hidden></button>'
  + '<nav class="mx-reader-panel mx-reader-panel--menu" data-mx-reader-panel="menu" aria-label="Menu" hidden>'
  + '<a class="mx-reader-brand" href="/" target="_top"><img src="/logo-128.png" alt="">artifactbin</a>'
  + '<a href="/" target="_top">Artifacts</a><a href="/account" target="_top">Account</a>'
  + '<a href="/docs-human" target="_top">Human Docs</a><a href="/docs/artifactbin/SKILL.md" target="_top">Agent docs</a>'
  + '</nav>'
  + '<section class="mx-reader-panel mx-reader-panel--controls" data-mx-reader-panel="controls" aria-label="Artifact controls" hidden>'
  + '<h2>artifact controls</h2><h3>appearance</h3>'
  + '<div class="mx-reader-modes" role="group" aria-label="Color mode">'
  + `<button type="button" data-mx-mode-choice="light" aria-label="Light mode">${ICON_SUN}light</button>`
  + `<button type="button" data-mx-mode-choice="dark" aria-label="Dark mode">${ICON_MOON}dark</button>`
  + '</div>'
  + (signIn || fork ? '<h3>this document</h3>' : '')
  + (signIn ? renderSignIn(signIn) : '')
  + (fork ? renderFork(fork) : '')
  + '</section></div>';

const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** `</style` inside CSS would close the tag early; CSS has no use for the sequence. */
const styleTag = (attr: string, css: string): string =>
  `<style ${attr}>${css.replace(/<\/style/gi, '')}</style>`;

/**
 * Platform chrome inside the opaque document. It comes after author CSS and
 * uses a prefixed namespace so a story's own footer styles cannot accidentally
 * repaint it. The story root gets a viewport floor so a short artifact still
 * places the credits at the bottom; long documents simply continue naturally.
 */
const STORY_CREDITS_CSS = `
body[data-mx-story-root] > #mx-story-root {
  min-height: calc(100vh - 52px) !important;
  box-sizing: border-box !important;
}
.mx-artifact-credits {
  display: flex !important; flex-direction: column !important;
  align-items: center !important; justify-content: center !important;
  gap: 4px !important; width: 100% !important; min-height: 52px !important;
  box-sizing: border-box !important; margin: 0 !important; padding: 0 12px !important;
  border: 0 !important; border-top: 1px solid #202832 !important;
  background: #10151b !important; color: #e6edf3 !important;
  font-family: ui-monospace, "SFMono-Regular", Consolas, "Liberation Mono", monospace !important;
  font-size: 12px !important; font-weight: 400 !important; line-height: 1 !important;
}
.mx-artifact-credits a {
  display: inline-flex !important; align-items: center !important; gap: 4px !important;
  margin: 0 !important; padding: 0 !important; border: 0 !important;
  background: transparent !important; color: #e6edf3 !important;
  font: inherit !important; text-decoration: none !important;
  transition: color 120ms ease !important;
}
.mx-artifact-credits a:hover { color: #3fe77b !important; }
.mx-artifact-credits__heart {
  color: #ef4444 !important; font-family: Arial, sans-serif !important;
  font-size: 13px !important; line-height: 1 !important;
}
.mx-artifact-credits__host { gap: 6px !important; }
.mx-artifact-credits__forked { color: #8b949e !important; font: inherit !important; }
.mx-artifact-credits__forked a { display: inline !important; color: #8b949e !important; text-decoration: underline !important; }
.mx-artifact-credits__forked a:hover { color: #3fe77b !important; }
.mx-artifact-credits__logo {
  display: block !important; width: 14px !important; height: 14px !important;
  margin: 0 !important; padding: 0 !important; border: 0 !important;
}
`;

/**
 * PROVENANCE, said in the credits and nowhere else.
 *
 * Two shapes, and the second is the load-bearing one: with an href it names
 * and links the source; without one it says only that there WAS a source. The
 * label is the route's, not this module's, precisely so that "unlisted",
 * "private" and "deleted" arrive here already indistinguishable — a line that
 * could tell them apart is an existence oracle, and one that names an unlisted
 * source is a listing surface for a tier that exists to have none.
 */
const renderForkedFrom = (forkedFrom: NonNullable<NonNullable<StoryDocumentInput['credits']>['forkedFrom']>): string => {
  const label = escapeHtml(forkedFrom.label);
  // With no href the label is plain TEXT rather than an element of its own:
  // "forked from a private document" has to read as one sentence, and nothing
  // in the DOM should mark where the name would have been.
  const inner = forkedFrom.href
    ? `<a href="${escapeHtml(forkedFrom.href)}" target="_top" aria-label="Open the artifact this was forked from">${label}</a>`
    : label;
  return `<span class="mx-artifact-credits__forked" data-mx-forked-from>forked from ${inner}</span>`;
};

const renderCredits = (credits: NonNullable<StoryDocumentInput['credits']>): string => {
  const username = credits.creatorUsername;
  const creator = username
    ? `<a href="/@${escapeHtml(username)}" target="_top" aria-label="View @${escapeHtml(username)}'s profile">`
      + `made with <span class="mx-artifact-credits__heart" aria-hidden="true">&hearts;</span> by @${escapeHtml(username)}</a>`
    : '';
  const forked = credits.forkedFrom ? renderForkedFrom(credits.forkedFrom) : '';
  return `<footer class="mx-artifact-credits" aria-label="Artifact credits">${creator}${forked}`
    + `<a class="mx-artifact-credits__host" href="/" target="_top" aria-label="Hosted on artifactbin">`
    + `<img class="mx-artifact-credits__logo" src="/logo-128.png" alt="">hosted on artifactbin</a></footer>`;
};

export async function buildStoryDocument(input: StoryDocumentInput): Promise<string> {
  const { source, compiledCss, theme, template = null, colorMode, refData, runtimeSrc, anchorSrc, commentSrc, live = null, chrome = true, social = null, help = null, signIn = null, fork = null } = input;
  const dataflow = input.dataflow ?? null;
  // Chrome-less documents are capture inputs. Keep the omission structural so
  // a future caller cannot accidentally burn attribution into an export by
  // passing both `chrome: false` and credits.
  const credits = chrome ? input.credits : null;

  const parsed = parseJsx(source);
  /*
   * Nesting the HTML parser will not undo, applied on the way OUT as well as
   * on the way in (canonicalizeMarkup). Two different jobs: the door keeps
   * stored source honest, so an agent's read-before-write and the editor's
   * re-serialization see the same tree we serve — but every document published
   * BEFORE that door existed is still stored with the fault, and would keep
   * repainting on every read until someone happened to write to it.
   *
   * It has to happen HERE, above the split, rather than in either renderer:
   * `split.body` feeds both the SSR string and the island the client hydrates
   * FROM, and the whole failure is those two disagreeing. One transform, one
   * tree, nothing left to diverge.
   */
  const split = parsed.ok ? splitHelmet(fixHtmlNesting(parsed.nodes)) : null;
  const helmet: HelmetContent = split?.content ?? EMPTY_HELMET_CONTENT;

  // Mode resolution lives HERE, for every reader: a theme is designed for
  // one mode and wins; colorMode decides unthemed documents. The edit canvas
  // resolves it the same way (JsxArtifactEditor), which is what keeps a
  // document from being edited in a mode it will never be read in.
  const mode = resolveStoryMode(theme, colorMode);
  const title = helmet.title?.trim() || input.title || 'artifact';

  /*
   * Resolved ONCE and handed to both the SSR render and the island below: the
   * two are compared by React at hydration, so a second resolution — or one of
   * them missing — is a mismatch. Empty for a document that draws no icons,
   * which is 153 of the 155 on production.
   */
  const glyphs = split ? loadSsrBundle().glyphsForNodes(split.body) : {};

  const bodyHtml = split
    ? loadSsrBundle().renderStoryBody({ nodes: split.body, refData, glyphs, ...(dataflow ? { dataflow } : {}), colorMode: mode, template, chrome })
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
    credits ? styleTag('data-mx-credits', STORY_CREDITS_CSS) : '',
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

  const island: StoryIslandData = { nodes: split?.body ?? [], refData, ...(Object.keys(glyphs).length ? { glyphs } : {}), ...(dataflow ? { dataflow } : {}), colorMode: mode, template, chrome, ...(input.queryUrl ? { queryUrl: input.queryUrl } : {}), ...(input.mutateUrl ? { mutateUrl: input.mutateUrl } : {}) };
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
    (chrome ? renderReaderChrome(signIn, fork) : '') +
    (credits ? renderCredits(credits) : '') +
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
