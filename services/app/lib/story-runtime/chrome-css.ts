/**
 * The document's own navigation chrome, as CSS — react-free so the builder
 * (which compiles inside the Next server graph) can inline it into <head>
 * without importing the runtime's React half.
 *
 * Inlined by the SERVER, not injected by the runtime: the rail is a layout
 * sibling of the document, so a rail that arrived with hydration would shift
 * every deck 190px sideways one tick after it painted — the exact regression
 * scripts/gate-layout-shift.mjs was written for. Server CSS + server-rendered
 * rail (discovery is a pure AST walk now) means the deck's first paint is its
 * final geometry.
 *
 * Every selector is `mx-`prefixed and every rule is scoped under one of them,
 * so author CSS and this can never collide.
 *
 * Colours come from the DOCUMENT's own theme tokens (`--background`,
 * `--foreground`, `--border`, `--muted-foreground`), never from system colours.
 * `canvas` looked right on a light document and rendered the whole rail white
 * on a dark one — a deck in `nocturne` had an illegible rail and a washed-out
 * present bar. The system colours survive only as fallbacks, for the case where
 * a document carries no compiled sheet at all.
 */
/**
 * THE DOCUMENT COLUMN — inlined with EVERY document, capture included (unlike
 * the chrome below, which a capture is served without). It is what authored
 * markup is measured against, and a capture measuring something else would
 * photograph a layout no reader sees.
 *
 * `container-type: inline-size` is the load-bearing half, and it is here to
 * make the full-bleed idiom we ship actually cancel. That idiom
 * (lib/data/story/typography FULL_BLEED_CLASSES, taught in skills/markup and
 * orchestrator/prompts/story-guidance.yaml) pairs `px-6 @2xl:px-12` on the page
 * wrapper with `-mx-6 @2xl:-mx-12` on a slide that wants the whole column — and
 * the two only cancel if both queries resolve against the SAME container.
 *
 * An `@container` utility resolves against the nearest ANCESTOR container:
 * declaring `@container` on the wrapper serves its CHILDREN, never its own
 * `@2xl:` utilities. With no container above it, the wrapper's `@2xl:px-12`
 * matched at NO width while the slide's `@2xl:-mx-12` matched at every desktop
 * one — so a deck cancelled 48px of gutter that was only ever 24px and hung
 * 24px past the column on both sides. Measured: 24px of horizontal overflow,
 * and 24px of slide painted over the rail with the page unscrolled. The rail is
 * `position: sticky`, which sticks only VERTICALLY, so scrolling those 24px
 * then dragged the deck's own navigation off the screen.
 *
 * The cost, stated plainly: inline-size containment makes this a containing
 * block for `position: fixed` descendants. The rail and the present bar are
 * SIBLINGS of the column and unaffected; an authored fixed overlay INSIDE a
 * document now anchors to the column rather than the viewport.
 */
/*
 * `overflow-x: clip` is the column's own backstop, for the bleed an author got
 * WRONG: the idiom above cancels exactly when the wrapper's gutter matches the
 * bleed's negative margin, and nothing can make it cancel when they differ —
 * a real dashboard paired `-mx-6 @2xl:-mx-12` with a `px-4 @2xl:px-6` wrapper
 * and hung 24px past the column, a sliver of sideways page scroll with nothing
 * on screen to say why. Same rule tables already live by: the page never
 * scrolls horizontally. `clip`, never `hidden`: clip does not create a scroll
 * container, so overflow-y stays visible and sticky descendants are untouched.
 */
export const STORY_COLUMN_CSS = `
.mx-doc { flex: 1 1 auto; min-width: 0; container-type: inline-size; overflow-x: clip; }
`;

export const STORY_CHROME_CSS = `
.mx-deck { display: flex; align-items: flex-start; }
.mx-rail {
  position: sticky; top: 0; flex: 0 0 190px; width: 190px; height: 100vh;
  overflow-y: auto; overflow-x: hidden; box-sizing: border-box;
  padding: 12px 10px; border-right: 1px solid var(--border, rgba(128,128,128,0.25));
  background: var(--background, canvas);
  color: var(--foreground, canvastext);
  font-family: ui-sans-serif, system-ui, sans-serif;
}
.mx-rail-row {
  display: block; width: 100%; text-align: left; cursor: pointer;
  margin: 0 0 8px; padding: 6px; border: 1px solid transparent; border-radius: 6px;
  background: none; color: inherit; font: inherit;
}
.mx-rail-row:hover { background: color-mix(in srgb, var(--foreground, gray) 8%, transparent); }
.mx-rail-row[aria-current="true"] {
  border-color: var(--border, rgba(128,128,128,0.55));
  background: color-mix(in srgb, var(--foreground, gray) 12%, transparent);
}
.mx-rail-label { display: flex; gap: 6px; align-items: baseline; font-size: 11px; line-height: 1.3; }
.mx-rail-index { color: var(--muted-foreground, gray); font-variant-numeric: tabular-nums; }
.mx-rail-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* The rail's one edit affordance — visible only while the owner is editing,
   because that is the only time the runtime renders it at all. */
.mx-rail-rename { margin-left: auto; padding: 0 4px; opacity: 0; cursor: pointer; font-size: 11px; }
.mx-rail-row:hover .mx-rail-rename, .mx-rail-rename:focus { opacity: 0.75; }
input.mx-rail-title { min-width: 0; width: 100%; background: transparent; border: 1px solid currentColor; border-radius: 3px; color: inherit; font: inherit; padding: 0 2px; }
/* The preview box is RESERVED at its final size — a preview that grows on
   arrival pushes every row below it down (the thumbnail lesson). */
.mx-rail-thumb {
  /* block, not the span's default inline: aspect-ratio does nothing on an
     inline box, so the preview had no height and spilled over its row. */
  display: block;
  position: relative; width: 100%; aspect-ratio: 16 / 10; margin-top: 4px;
  overflow: hidden; border: 1px solid var(--border, rgba(128,128,128,0.25)); border-radius: 4px;
  background: var(--background, canvas); pointer-events: none;
}
.mx-rail-thumb > div {
  position: absolute; top: 0; left: 0; width: 1280px; height: 800px;
  transform: scale(0.128); transform-origin: top left;
}
.mx-present {
  position: fixed; left: 50%; bottom: calc(16px + var(--mx-footer-inset, 0px)); transform: translateX(-50%);
  display: flex; align-items: center; gap: 6px; z-index: 2147483000;
  padding: 5px 8px; border: 1px solid var(--border, rgba(128,128,128,0.35)); border-radius: 999px;
  background: color-mix(in srgb, var(--background, canvas) 88%, transparent);
  color: var(--foreground, canvastext);
  backdrop-filter: blur(6px);
  font-family: ui-sans-serif, system-ui, sans-serif; font-size: 12px;
}
.mx-present button {
  cursor: pointer; border: 0; border-radius: 999px; background: none; color: inherit;
  font: inherit; padding: 2px 8px; line-height: 1.4;
}
.mx-present button:hover { background: color-mix(in srgb, var(--foreground, gray) 14%, transparent); }
.mx-present-count { font-variant-numeric: tabular-nums; color: var(--muted-foreground, gray); padding: 0 2px; }
/* Presenting is the document alone: the rail would be in the projected frame. */
:fullscreen .mx-rail { display: none; }
@media (max-width: 720px) { .mx-rail { display: none; } }
/*
 * THE OUTLINE — a sectioned document's table of contents (lib/story-runtime/
 * outline). The same shape as the deck rail and for the same reason: a flex
 * SIBLING of the document, sticky within the viewport, server-rendered at its
 * final width so the column never jumps. Narrower than the rail (no previews
 * to hold) and gone under 1024px, where the column needs every pixel — and
 * gone when presenting, where the document is alone on the screen.
 */
.mx-reading { display: flex; align-items: flex-start; }
.mx-outline {
  position: sticky; top: 0; flex: 0 0 208px; width: 208px; max-height: 100vh;
  overflow-y: auto; overflow-x: hidden; box-sizing: border-box;
  /* The page hamburger occupies the first 48px of the corner. Begin the
     structural navigation below it, with a small gap instead of an overlap. */
  padding: 56px 20px 36px 24px;
  color: var(--muted-foreground, gray);
  font-family: var(--font-body, ui-sans-serif, system-ui, sans-serif);
  font-size: 12.5px; line-height: 1.4;
}
.mx-outline-label {
  margin: 0 0 10px 12px; font-size: 10.5px; letter-spacing: 0.1em; text-transform: uppercase;
  font-family: var(--font-mono, ui-monospace, monospace);
}
.mx-outline-row {
  display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2;
  width: 100%; text-align: left; cursor: pointer;
  margin: 0; padding: 4px 0 4px 12px;
  border: 0; border-left: 2px solid var(--border, rgba(128,128,128,0.25));
  background: none; color: inherit; font: inherit;
  /* Two lines, then an ellipsis: a section title is a claim, and "1. A dataset
     is already …" tells the reader nothing about where the row goes. */
  overflow: hidden; overflow-wrap: anywhere;
}
.mx-outline-row:hover { color: var(--foreground, canvastext); }
.mx-outline-row[aria-current="true"] { color: var(--foreground, canvastext); border-left-color: var(--primary, currentColor); }
.mx-outline-sub { padding-left: 24px; font-size: 12px; }
:fullscreen .mx-outline { display: none; }
@media (max-width: 1023px) { .mx-outline { display: none; } }
@media print { .mx-outline { display: none; } }
/*
 * QUIET READER CHROME. The top-level document mirrors the app shell's two
 * page-mounted controls. A framed owner/editor copy hides these: its trusted
 * parent supplies the same visual controls plus authenticated actions.
 */
:root.mx-framed .mx-reader-chrome { display: none !important; }
.mx-reader-chrome { color: var(--foreground, canvastext) !important; font-family: var(--font-mono, ui-monospace, monospace) !important; }
.mx-reader-chrome [hidden] { display: none !important; }
.mx-reader-trigger {
  position: fixed !important; top: max(12px, env(safe-area-inset-top)) !important; z-index: 2147483003 !important;
  display: flex !important; align-items: center !important; justify-content: center !important; cursor: pointer !important;
  width: 36px !important; height: 36px !important; margin: 0 !important; padding: 0 !important; border-radius: 999px !important;
  border: 1px solid var(--border, rgba(128,128,128,0.35)) !important;
  background: color-mix(in srgb, var(--background, canvas) 90%, transparent) !important;
  color: var(--muted-foreground, canvastext) !important; box-shadow: 0 2px 10px rgba(0,0,0,.12) !important;
  backdrop-filter: blur(8px) !important; transition: color 120ms ease, background 120ms ease, transform 120ms ease !important;
}
.mx-reader-trigger:hover { color: var(--foreground, canvastext) !important; }
.mx-reader-trigger:active { transform: scale(.96) !important; }
.mx-reader-trigger--left { left: max(12px, env(safe-area-inset-left)) !important; }
.mx-reader-trigger--right { right: max(12px, env(safe-area-inset-right)) !important; }
.mx-reader-trigger .mx-rc-close { display: none !important; }
.mx-reader-trigger[aria-expanded="true"] .mx-rc-open { display: none !important; }
.mx-reader-trigger[aria-expanded="true"] .mx-rc-close { display: block !important; }
.mx-reader-home { display: none !important; }
.mx-reader-label { display: none !important; }
.mx-reader-scrim {
  position: fixed !important; inset: 0 !important; z-index: 2147483000 !important;
  width: auto !important; height: auto !important; margin: 0 !important; padding: 0 !important;
  cursor: default !important; border: 0 !important; background: rgba(0,0,0,.24) !important;
}
.mx-reader-panel {
  position: fixed !important; z-index: 2147483002 !important; box-sizing: border-box !important;
  border: 1px solid var(--border, rgba(128,128,128,.3)) !important;
  background: var(--background, canvas) !important; color: var(--foreground, canvastext) !important;
  box-shadow: 0 14px 42px rgba(0,0,0,.2) !important;
  font: 500 12px/1.35 var(--font-mono, ui-monospace, monospace) !important;
}
.mx-reader-panel--menu {
  inset: 0 auto 0 0 !important; display: flex !important; width: 288px !important;
  flex-direction: column !important; gap: 2px !important; padding: 64px 8px 10px !important;
  border-width: 0 1px 0 0 !important; animation: mx-reader-drawer 150ms ease-out !important;
}
.mx-reader-panel--menu a {
  display: flex !important; align-items: center !important; gap: 10px !important; box-sizing: border-box !important;
  width: 100% !important; padding: 9px 10px !important; border-radius: 5px !important;
  color: var(--muted-foreground, canvastext) !important; text-decoration: none !important;
}
.mx-reader-panel--menu a:hover { background: color-mix(in srgb, var(--foreground, gray) 8%, transparent) !important; color: var(--foreground, canvastext) !important; }
.mx-reader-panel--menu .mx-reader-brand {
  margin-bottom: 10px !important; padding-bottom: 12px !important; border-bottom: 1px solid var(--border, rgba(128,128,128,.3)) !important;
  color: var(--foreground, canvastext) !important; font-size: 14px !important; font-weight: 700 !important;
}
.mx-reader-brand img { width: 28px !important; height: 28px !important; margin: 0 !important; border: 0 !important; }
.mx-reader-panel--controls {
  top: 56px !important; right: 12px !important; width: 288px !important; padding: 13px !important;
  border-radius: 7px !important; animation: mx-reader-rise 140ms ease-out !important;
}
.mx-reader-panel--controls h2, .mx-reader-panel--controls h3 { margin: 0 !important; font-family: inherit !important; }
.mx-reader-panel--controls h2 { margin-bottom: 14px !important; font-size: 12px !important; }
.mx-reader-panel--controls h3 { margin-bottom: 7px !important; color: var(--muted-foreground, canvastext) !important; font-size: 10px !important; letter-spacing: .14em !important; text-transform: uppercase !important; }
.mx-reader-modes { display: flex !important; overflow: hidden !important; border: 1px solid var(--border, rgba(128,128,128,.3)) !important; border-radius: 5px !important; }
.mx-reader-modes button {
  display: flex !important; flex: 1 1 0 !important; align-items: center !important; justify-content: center !important; gap: 7px !important;
  min-height: 36px !important; margin: 0 !important; padding: 7px 10px !important; cursor: pointer !important;
  border: 0 !important; background: transparent !important; color: var(--muted-foreground, canvastext) !important; font: inherit !important;
}
.mx-reader-modes button[aria-pressed="true"] { background: color-mix(in srgb, var(--primary, currentColor) 12%, transparent) !important; color: var(--primary, currentColor) !important; }
/* The login door, under its own heading in the controls panel. Sized like a
   mode button so the panel reads as one column of controls. */
.mx-reader-panel--controls h3 + .mx-reader-signin { margin-top: 0 !important; }
.mx-reader-signin {
  display: flex !important; align-items: center !important; justify-content: center !important;
  min-height: 36px !important; margin: 0 !important; padding: 7px 10px !important;
  border: 1px solid var(--border, rgba(128,128,128,.3)) !important; border-radius: 5px !important;
  background: color-mix(in srgb, var(--primary, currentColor) 10%, transparent) !important;
  color: var(--primary, currentColor) !important; font: inherit !important; text-decoration: none !important;
}
.mx-reader-signin:hover { background: color-mix(in srgb, var(--primary, currentColor) 18%, transparent) !important; }
.mx-reader-panel--controls .mx-reader-modes + h3 { margin-top: 14px !important; }
@keyframes mx-reader-drawer { from { transform: translateX(-100%); } }
@keyframes mx-reader-rise { from { opacity: 0; transform: translateY(-4px); } }
@media (max-width: 639px) {
  .mx-reader-chrome {
    position: fixed !important; inset: auto 0 0 !important;
    display: grid !important; grid-template-columns: 1fr auto 1fr !important; align-items: center !important;
    box-sizing: border-box !important; width: 100% !important; margin: 0 !important;
    padding: 4px 0 max(4px, env(safe-area-inset-bottom)) !important;
    border: 0 !important; border-top: 1px solid var(--border, rgba(128,128,128,.35)) !important; border-radius: 0 !important;
    background: color-mix(in srgb, var(--background, canvas) 92%, transparent) !important;
    box-shadow: 0 -8px 24px rgba(0,0,0,.12) !important;
    transition: transform 200ms ease-out, opacity 200ms ease-out !important;
  }
  .mx-reader-chrome--hidden { transform: translateY(calc(100% + 64px)) !important; opacity: 0 !important; pointer-events: none !important; }
  .mx-reader-trigger {
    position: static !important; width: 44px !important; height: 44px !important; border: 0 !important;
    flex-direction: column !important; gap: 2px !important;
    border-radius: 8px !important; background: transparent !important; box-shadow: none !important; backdrop-filter: none !important;
  }
  .mx-reader-trigger--left { left: auto !important; justify-self: center !important; }
  .mx-reader-trigger--right { right: auto !important; justify-self: center !important; }
  .mx-reader-home {
    display: flex !important; align-items: center !important; justify-content: center !important; justify-self: center !important;
    flex-direction: column !important; gap: 2px !important;
    box-sizing: border-box !important; width: 44px !important; height: 44px !important; border-radius: 8px !important;
    color: var(--muted-foreground, canvastext) !important; text-decoration: none !important;
  }
  .mx-reader-label {
    display: block !important; font: 500 8px/1 var(--font-mono, ui-monospace, monospace) !important;
    letter-spacing: .04em !important; color: inherit !important;
  }
  .mx-reader-home:hover { background: color-mix(in srgb, var(--foreground, gray) 8%, transparent) !important; color: var(--foreground, canvastext) !important; }
  .mx-reader-panel--menu { width: 100% !important; }
  .mx-reader-panel--controls { inset: auto 0 0 0 !important; width: 100% !important; padding: 16px 13px max(76px, calc(env(safe-area-inset-bottom) + 64px)) !important; border-radius: 10px 10px 0 0 !important; }
}
@media (max-width: 639px) and (prefers-reduced-motion: reduce) { .mx-reader-chrome { transition: none !important; } }
:fullscreen .mx-reader-chrome { display: none !important; }
`;

/**
 * The EMBED busy state — the visible half of stale-while-revalidate. A value
 * change re-runs the queries that bind it; the rows on screen stay (no flash)
 * and the runtime marks each embed over an in-flight table `aria-busy` + this
 * class. Dim the content hard and center the ONE loading lockup the whole
 * platform speaks — spinner ring over a mono uppercase label (the lazy-chart
 * fallback and the pending-data placeholders in QuestionEmbed compose the
 * same lockup from utilities); the inline Number only dims (a lockup has no
 * room in a sentence). Inlined with EVERY document —
 * chrome-less exports included — because a document is a document either
 * way; the deck rail is the only chrome that is optional.
 */
/**
 * TABLES, in every document. A table is its own horizontal scroll box, capped
 * at its column: a wide one scrolls inside the column rather than pushing the
 * page sideways (which is what a 3-column table did to a phone, cut mid-word
 * with nothing to say so). `fit-content` makes it hug its rows by default; an
 * author's `w-full` still wins, because a utility outranks `:where`. The fade
 * is the affordance — shown on a table that CAN scroll (marked by
 * lib/story-runtime/table-scroll from the every-document entry) and dropped
 * once the reader reaches the last column, where nothing is hidden any more.
 */
export const STORY_TABLE_CSS = `
:where([data-mx-story-root]) table {
  display: block; width: fit-content; max-width: 100%; overflow-x: auto;
  -webkit-overflow-scrolling: touch;
}
:where([data-mx-story-root]) table[data-mx-scrollable] {
  mask-image: linear-gradient(to right, black calc(100% - 36px), transparent);
  -webkit-mask-image: linear-gradient(to right, black calc(100% - 36px), transparent);
}
:where([data-mx-story-root]) table[data-mx-scrollable="end"] { mask-image: none; -webkit-mask-image: none; }
`;

export const STORY_EMBED_CSS = `
.mx-busy { position: relative; }
.mx-busy > * { opacity: 0.3; transition: opacity 150ms ease; }
.mx-busy::before {
  content: ''; position: absolute; left: 50%; top: 50%; margin: -22px 0 0 -11px; z-index: 2;
  width: 22px; height: 22px; border-radius: 999px; pointer-events: none;
  border: 2px solid var(--border, rgba(128,128,128,0.35)); border-top-color: var(--primary, graytext);
  animation: mx-spin 0.8s linear infinite;
}
.mx-busy::after {
  content: 'updating…'; position: absolute; left: 50%; top: 50%; transform: translateX(-50%); margin-top: 8px;
  z-index: 2; pointer-events: none;
  font: 500 11px/1 var(--font-mono, ui-monospace, monospace); letter-spacing: 0.08em; text-transform: uppercase;
  color: var(--muted-foreground, graytext);
}
.mx-busy-inline { opacity: 0.55; transition: opacity 150ms ease; }
@keyframes mx-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .mx-busy::before { animation: none; } }
`;
