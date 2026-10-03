# Markup and story UI

These rules cover `lib/story-ui` and the parser in `lib/jsx`, and only what is specific to markup.
The shared rules live once elsewhere and are not restated here: working rules and app chrome
(tooltips included) in the root [AGENTS.md](../../../../AGENTS.md); node identity, the runtime and
where the author script runs in [serving and security](../../../../docs/serving-and-security.md). Read those first.

- Static JSX is data. `lib/jsx/parse.ts` uses acorn/acorn-jsx and records non-static expressions.
  Validation accepts only allowlisted reactive/row expressions in permitted scopes and rejects the
  rest with useful spans. Do not replace this with an executable JSX/MDX compiler.
- Validation at publish (`lib/jsx/validate.ts`) is the one markup policy: denied tags and attributes, event
  handlers, URL schemes, SVG paint references and component vocabulary are decided there and nowhere else.
  The renderer (`interpreter-primitives.ts` `rawBuildProps`, the compiler) only renders — spellings, the
  `style` string as an object, controlled-to-uncontrolled props — and re-checks no policy: every document
  runs on its own origin under the document CSP, and a document that predates a rule is migrated by
  republishing, never filtered at render. Account for authored HTML spellings versus compiled JSX prop names.
- The publish path (`lib/story/document/jsx-tier.ts`) owns markup policy, sanitization and CSS compilation.
  Inline style policy and authored style blocks have different rules. Do not relax one because another
  layer also sanitizes.
- The final model: each document is served on its own origin, framed by the app page, and calls its
  own data doors directly under the document CSP (plus the hosts its Helmet declares and its reader
  allowed). Its Helmet script is a Solid module built at publish (`lib/story/document/author-module.server`)
  and run in the document by `lib/islands/page-runtime`; it binds declared names with `signal`, `query`
  and `mutation` from `page`, and an exported component mounts at a markup tag (`data-mx-mount`) over
  its fallback, which edit mode shows read-only. There is no author frame, `mx` bridge or managed `<Iframe>`.
- `lib/jsx/serialize.ts` must preserve entity escaping and static template-literal children: SQL and
  CSS containing quotes, angle brackets or braces must survive repeated edit/serialize/parse cycles.
- Component names must agree between `component-names.ts`, the compiler's `KIT` table and JSX validation.
  Keep the names module free of the kit so server validation does not pull in the rendering graph.
- Preserve keys and node identity across updates, and never serialize generated `data-mx-*` or
  editing attributes as source.
- Grid geometry belongs to `grid-layout.ts`; edit and view placement must use the same arithmetic.
  Grid drag/resize writes source through `lib/data/story/jsx-edit.ts`. Slide discovery belongs to
  `lib/story-runtime/slides.ts`; previews must not introduce a second live data subscription.
- Floating UI must remain in the document's correct DOM/window. Do not reintroduce obsolete
  SVG/foreignObject positioning workarounds.
- `lib/story-ui/recipe-classes.ts` is generated: every string-literal token in `lib/islands/kit/`
  plus the files `EXTRA_CLASS_SOURCES` names (parsed with the TypeScript scanner). After touching those
  inputs run `npm run generate-story-ui-classes`; `recipe-classes.test.ts` fails when it is stale.
  `lib/data/story/typography.ts` supplies the editor's class vocabulary; the CSS union/version must
  change together so saved documents recompile.
- Verify parser/serialization, publish rejection, SSR/hydration and affected editing
  behavior. Use existing browser gates for geometry and real browser isolation, not DOM mocks alone.
