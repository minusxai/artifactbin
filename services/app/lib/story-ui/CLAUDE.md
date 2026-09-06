# Story authoring — JSX as data

How authored markup becomes a renderable tree: `lib/jsx` (static JSX parsed to inert data, with the
prop deny-list and validation) and `lib/story-ui` (the component registry and interpreter).

These two are grouped because they share consumers — `components/views`, `lib/data/story`,
`lib/validation`.

These trees are rendered in exactly ONE place: the SERVED document
(`lib/story-runtime`, SSR'd by `lib/story/document.ts` and hydrated in an opaque-origin
iframe). The same-origin editing canvas that used to render them a second time is gone,
and with it `lib/story-surface`'s mounting/serializing machinery and `lib/html`'s iframe
plumbing — editing is a mode the served document enters IN PLACE (`lib/story-runtime/edit/`).

> PORTED from MinusX along with the code it documents, and edited to match this repo.
> Paths are repo-relative (MinusX's `frontend/` prefix is dropped). There is no capture
> tier here — artifactbin rasterizes a served document with headless Chromium instead
> (`lib/export.ts`). The root `CLAUDE.md` carries the system overview and the principles
> that apply everywhere.

## `lib/jsx` — static JSX as inert data

`parseJsx` (acorn + acorn-jsx, isomorphic) wraps the source in `<>…</>` so multiple roots are legal,
offset-corrects positions back, and normalizes to `JsxElement | JsxText | JsxExpression`. Attribute
and child `{…}` expressions are resolved to JSON literals where possible (literals, `+`/`-` numbers,
arrays, plain objects, and a **single-quasi template literal** — which is how SQL and CSS survive as
data); **non-static expressions are recorded, not thrown**, so `validateJsx` can reject them with a
precise span. A spread attribute is recorded as the pseudo-attribute `...`. Only an acorn syntax
error yields `{ ok: false }`.

`validate.ts` is the security boundary — a JSX parser gives no "static" guarantee for free. It
rejects: non-JSON attribute values and spreads, `on*` handlers, name-denied attrs
(`dangerouslySetInnerHTML`, `ref`, `key`, `srcdoc`, `is`), dangerous tags
(`script`/`iframe`/`object`/`embed`/`base`/`meta`/`link`/`form`/`frame`/`frameset`/`applet`/`noscript`),
unregistered Capitalized tags, tags outside an optional HTML allowlist, and dangerous URL schemes in
URL-bearing attributes (`href`, `src`, `action`, `formaction`, `poster`, `background`, `cite`,
`data`, `xlink:href`, `ping`). Scheme checking strips `[\x00-\x20]` first because browsers do
(`java\tscript:` resolves as `javascript:`); `srcset`/`ping` are checked per list entry;
`data:image/*` is allowed, other `data:` is not. An unknown-component error always lists the
registered set, and names the legacy trap when the tag is a retired design-system component — the
message is the model's only route to self-correction.

The optional `stylePolicy:'no-inline-style'` adds the Story authoring boundary: authored `<style>`
BLOCKS are allowed (custom keyframes/classes are in-distribution vocabulary; the banned-css sanitizer
strips fixed/sticky and external url()/@import from them at save, and viewport-height units are
remapped there too), while inline `style`/`labelStyle` attributes stay rejected with recovery
guidance pointing to className utilities or the style block. The compiled per-story sheet emits
utilities `!important` on the jsx tier, so a Tailwind class always beats authored CSS.
`lib/story/jsx-tier.ts` applies the policy at the publish door: validate → banned-css sanitize →
Tailwind compile, one pass, the same for every write.

`serialize.ts` is the inverse and the round-trip is load-bearing: strings are entity-escaped
(`&`, `"`, `<`, `>` in attributes; plus `{`/`}` in text), because acorn-jsx *decodes* entities and
does **not** process backslash escapes — `JSON.stringify`ing an attribute containing `"` would
terminate the attribute and lock the file out of every subsequent edit. Static string expression
children re-emit as template literals so SQL/CSS keep `<`, `>`, `{` raw.

`components.ts` holds the one allowlist: `JSX_STORY_COMPONENT_NAMES` — the live embeds
`Question` / `Number` plus `STORY_UI_COMPONENT_NAME_LIST` — which every path validates against.
The retired design-system names in `lib/data/story/story-components.ts` are NOT in it; they survive
only so `lib/jsx/validate.ts` can answer an agent that reaches for one with a message naming the
replacement. Names only — no React
import — so server-side save validation stays headless.

## `lib/story-ui` — registry and interpreter

`registry.ts` maps ~60 tag names to the vendored shadcn components in `components/kit/*`
(`STORY_UI_COMPONENTS`; `STORY_UI_COMPONENT_NAMES` is its `Object.keys`).
`component-names.ts` is the same list as data only (`STORY_UI_COMPONENT_NAME_LIST`) plus
`STORY_HTML_TAGS`, the explicit HTML allowlist for new-format stories; `__tests__/registry-names.test.ts`
asserts the two never drift. Adding a component means editing **both** files.

## The story grid — `Grid` / `GridItem`

`components/kit/grid.tsx` is the dashboard-style positioned layout for jsx stories (registered
like any other component; the name collides with the retired LEGACY `Grid` in
`lib/data/story/story-components.ts` deliberately — separate allowlists, same precedent as `Card`).
View mode is **pure CSS**: items are absolutely positioned from CSS variables consumed by literal
Tailwind arbitrary-value classes (spaceless `calc()` — the recipe-class extractor splits string
literals on whitespace), so captures serialize by construction and no JS measures anything.
Below the `@2xl` container width items stack in source order, KEEPING their px height (embeds
inside fill the cell at 100% via the exported `GridItemContext`, so auto height would collapse
them). `lib/data/story/__tests__/story-css-grid.test.ts` pins that the per-story Tailwind compile
actually EMITS these rules — candidates being extracted is not proof of emission.

`grid-layout.ts` is the pure geometry (12 cols × 86px rows — the dashboard's 80+6 folded; the
gutter is `p-[3px]` INSIDE each item so edit-mode react-grid-layout runs `margin [0,0]` and both
modes place with identical arithmetic). It owns the single defaulting/clamping rule
(`gridItemRect`) and the drag-commit diff (`diffLayouts` — empty diff = the mount-echo guard).
`grid-css.ts` is the hand-vendored RGL structural CSS for edit mode (transitions killed),
injected by `lib/story-runtime/edit/grid-edit.tsx` INSIDE the document — head styles never reach
it, and the drag has to happen there because only the document knows how wide its own columns are.
Edit-mode drag/resize commits are the edit session's THIRD edit kind: `applyLayoutEditsToJsx`
(`lib/data/story/jsx-edit.ts`) writes x/y/w/h back by AST path, composed after text and format
edits. The RGL item key IS the GridItem's `data-mx-ast` path.

## The slide deck — `SlideDeck` / `Slide`

`components/kit/slides.tsx` is the presentation layout for jsx stories (the `deck` template's
slide recipe as a component). Pure stacked flow: each `Slide` is a full-viewport flex column
(`min-h-[var(--mx-vh,760px)]` — the served document sets `--mx-vh` to its own viewport height),
so captures serialize by construction and nothing measures anything. `Slide` deliberately sets no `w-full`: an explicit 100% width breaks
the full-bleed divider recipe (negative side margins over a fixed width).

Each rendered slide is stamped `data-mx-slide` (+ `data-mx-slide-title` when authored) — render
artifacts (covered by the `data-mx-*` write-back strip), and the discovery contract for the deck's
own chrome. That chrome lives INSIDE the document (`lib/story-runtime/slides.ts`): discovery is a
pure AST walk of the nodes the island already carries, so the rail is SERVER-rendered at its final
width and a deck's first paint is its final geometry. Rail previews are the slide's own nodes
re-rendered and scaled — always current, nothing to capture, and no second mount of an embed (which
is exactly what the raster thumbnails this replaced were there to avoid). Renaming a slide from the
rail is an edit like any other: the document reports it, the page writes it back by AST path
(`lib/data/story/story-slides.ts`).

`interpreter.tsx` turns a validated AST into React elements over an injected registry:

```
JsxNode[] ──renderStoryNodes(nodes, { components, decorateElement })──▶ React.ReactNode
             per node: buildProps → React.createElement(Component ?? tag.toLowerCase())
```

It is **defense in depth, not a second validator**: even on an unvalidated AST it drops `on*` props,
`DENIED_PROPS`, dangerous URL schemes and non-static values, so nothing executable reaches React.
Unknown Capitalized tags render nothing. Author-side HTML spellings are mapped (`class`→`className`,
`for`→`htmlFor`); `style` accepts a CSS string or an object and is sanitized to string/number values.
Object/array values are kept on components (the `viz`/`params` envelopes) and dropped on HTML tags,
where React would stringify them into attributes to no purpose. Controlled props are rewritten to
their uncontrolled forms, but `value`→`defaultValue` **only on `Tabs`/`Accordion`** — elsewhere
`value` names a pane (`TabsTrigger`, `AccordionItem`) or is the displayed number (`Progress`), and
rewriting it breaks the component.

The interpreter and `validateJsxSource` are two *independent* gates with the *same intent*, and
neither may be relaxed on the assumption that the other caught it: the interpreter runs on stored
markup that was validated by an older version of the rules, and the validator runs server-side where
React is never imported. The two deny/URL lists are hand-mirrored, so **edit them together** —
`DENIED_ATTRS`/`URL_ATTRS`/`URL_LIST_ATTRS` in `lib/jsx/validate.ts` and
`DENIED_PROPS`/`URL_PROPS`/`URL_LIST_PROPS` in `interpreter.tsx`. They already diverge on one entry:
the validator sees the authored spelling `xlink:href` while the interpreter sees the React prop name
`xlinkhref`, so neither list catches the other's form.

Every element is stamped `data-mx-ast="<path>"` (dot-separated child indexes counting *all* nodes).
That stamp is how `lib/data/story/jsx-edit.ts` maps a WYSIWYG DOM edit back to the JSX source node;
`decorateElement` is the interpreter's wrapping seam: `StoryRuntimeApp` uses it to resolve `ref:`
props, and edit mode wraps LAST on top of that to make text hosts editable
(`lib/story-runtime/edit/session.tsx`). Implementations must preserve the element's `key`, which
carries the same path.

The vendored popover never portals, and the vendored tooltip drops its portal when
`TooltipProvider` is `portalled={false}`, so floating content stays inside the document's own subtree
instead of escaping to a body in another window. (`floating.ts` forced Radix's popper wrapper to
`absolute` for a canvas that rendered documents inside `<svg><foreignObject>`; this product serves them
in an iframe, where `position: fixed` works, and nothing injected that CSS.) `cn.ts` re-exports
`components/kit/cn.ts`.

## The compiled-CSS candidate set

`recipe-classes.ts` is **generated**, not hand-written: a Tailwind-candidate union extracted from
`components/kit` + `EMBED_CHROME_FILES` sources by `scripts/generate-story-ui-classes.ts`
(`npm run generate-story-ui-classes`), guarded for freshness by `__tests__/recipe-classes.test.ts`.
The extractor tokenizes **raw source text**, so even a comment edit to one of those files changes
the candidate set and trips the gate — regenerate after touching them, whatever you changed.

`lib/data/story/story-css.server.ts` compiles a story's CSS from that union plus the story's own
extracted candidates. The union is `STORY_RECIPE_UNION` = `STORY_UI_RECIPE_CLASSES` ∪
`STORY_WYSIWYG_CLASSES` (`lib/data/story/typography.ts`), and it is **also the hash source for
`storyCssCompileVersion()`** — so growing the format toolbar's palette flips the version and every
previously-saved story recompiles at read time
(`lib/data/story/__tests__/story-css-typography.test.ts`).

`lib/data/story/typography.ts` is that second half and the single source of truth for the WYSIWYG
format toolbar: which Tailwind classes it may apply (a curated token-based palette — the `text-*`
size scale, `font-bold`/`italic`/`underline`, the four alignments, curated `mt-*`/`mb-*`/`p-*` steps,
`max-w-prose`, and the full-bleed recipe) plus the pure class-string algebra that the live DOM
mutation and the AST write-back both call, so instant feedback and persisted source can never
diverge. `story-css.server.ts` pre-bakes that finite palette into every story's sheet, so applying
one of those classes is a DOM attribute change with zero recompile latency. Picker colors are the
deliberate unbounded exception: they persist as important arbitrary-value Tailwind utilities and
use a DOM-only inline preview until the story-specific CSS compile lands. Stepping is **relative
and in place** — every size/spacing token shifts one step including
variant-prefixed ones (`text-3xl @2xl:text-5xl` → `text-4xl @2xl:text-6xl`), because the story skill
mandates responsive type and a stepper that only rewrote the base token would leave the `@2xl:`
variant winning the cascade and masking the click.

## Key files

| Task | File |
|---|---|
| Add/deny a JSX attribute or tag | `lib/jsx/validate.ts` (+ mirror in `lib/story-ui/interpreter.tsx`) |
| Add a component stories can use | `lib/story-ui/registry.ts` **and** `lib/story-ui/component-names.ts` |
| Change grid geometry / drag-commit diff | `lib/story-ui/grid-layout.ts` (+ `components/kit/grid.tsx` classes) |
| Change slide sizing / stamps | `components/kit/slides.tsx` |
| Change slide discovery / the deck's rail | `lib/story-runtime/slides.ts` |
| Grid items misplaced in edit mode vs view mode | `lib/story-ui/grid-css.ts`, `lib/story-runtime/edit/grid-edit.tsx` |
| Allow another raw HTML tag | `lib/story-ui/component-names.ts` (`STORY_HTML_TAGS`) |
| Story CSS candidate list is short a class | `lib/story-ui/recipe-classes.ts` → `npm run generate-story-ui-classes` |
| Add a class the format toolbar can apply | `lib/data/story/typography.ts` (auto-unions into the compile and flips the CSS version) |
| Fix an agent's markup failing to parse | `lib/jsx/parse.ts` |
| A saved story loses its SQL/CSS or breaks on re-edit | `lib/jsx/serialize.ts` (entity escaping / template-literal children) |

## Design decisions

**Do not fork a JSX parser, and do not reach for MDX.** A post-parse validator over `acorn` +
`acorn-jsx` is less code and less maintenance than a dialect-specific parser, and it yields precise
diagnostics ("attribute `viz` uses a call expression — not allowed") instead of an opaque parse
failure, which is what lets the agent self-correct. MDX is the wrong shape at a deeper level: it
*compiles JSX to an executable JavaScript module*, reinstating the "it is code, not data" problem the
interpreter exists to avoid. The markup stays an inert AST that is interpreted, never evaluated.

**Prop filtering has to be a deny list, and that is forced by the component library.** Every one of
the 20 vendored kit components spreads `{...props}` onto its root element and enumerates nothing, so
there is no allow list of props that could be expressed — an unknown attribute reaches the DOM by
construction. Hence the global denials: `on*` handlers, `ref`, `key`, `dangerouslySetInnerHTML`,
`srcdoc`, `is`, style sanitized to string/number values, and scheme filtering on every URL-bearing
attribute. This matters because `content.story` is editable by any org user and rendered to other
viewers including anonymous guests — it is a real XSS boundary, not a lint.

**Author JavaScript runs only in an opaque child, never in the document renderer.**

`lib/story-runtime/author-script.ts` owns that hidden `sandbox="allow-scripts"` realm.
Helmet source stays inert until the runtime transfers it over a private MessageChannel.
Its bounded bridge exposes declared signals, query refreshes and mutations, not visible DOM,
account APIs, credentials or source editing. Changed/removed source replaces/revokes the realm.

There is ONE document renderer: `lib/story-runtime`, SSR'd by `lib/story/document.ts`.
With `APP__CONTROLS_ORIGIN` enabled it is top-level and the trusted app controls are a
cross-origin child. The default/raw/export path retains the existing opaque document sandbox.
Never evaluate general JSX expressions: restricted signal expressions remain an inert AST.

Editing is a MODE of that document. Its runtime owns `contentEditable` hosts and sends
authenticated, addressed edits to trusted controls. Author code cannot access those hosts.
Compose visibility with restricted JSX and dialogs with the kit primitives; local SQL updates
declared inline tables or the reserved `_signals` scalar projection through Mutation/run.

The interpreter's guarantees below are unchanged and apply to both: the AST stays inert data, and
nothing in it is ever executed.

**`format:'jsx'` story bodies are stored as jsx TEXT**, not as a stored AST. The AST is a transient in
every edit path, and the `data-mx-ast` stamps are render output only — `jsx-edit.ts` strips **any**
`data-mx-*`-prefixed attribute (matched by prefix, not by an enumerated list) plus `contenteditable`
before writing back, so a new render artifact is covered without an edit there.
