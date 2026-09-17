# Markup and story UI

These rules cover `lib/story-ui` and the parser in `lib/jsx`, and only what is specific to markup.
The shared rules live once elsewhere and are not restated here: working rules and app chrome
(tooltips included) in the root [AGENTS.md](../../../../AGENTS.md); node identity, the runtime
composition and build inputs in the [design notes](../../../../docs/design-notes.md); the author-script
sandbox boundary in [serving and security](../../../../docs/serving-and-security.md). Read those first.

- Static JSX is data. `lib/jsx/parse.ts` uses acorn/acorn-jsx and records non-static expressions.
  Validation accepts only allowlisted reactive/row expressions in permitted scopes and rejects the
  rest with useful spans. Do not replace this with an executable JSX/MDX compiler.
- Keep publish validation (`lib/jsx/validate.ts`) and renderer filtering (`interpreter.tsx`) independent.
  Stored content may predate current validation. Update both sides when changing denied attributes,
  URL schemes or component vocabulary; account for authored versus React attribute spellings.
- The publish path (`lib/story/jsx-tier.ts`) owns markup policy, sanitization and CSS compilation.
  Inline style policy and authored style blocks have different rules. Do not relax one because another
  layer also sanitizes. Managed HTML/iframes and author scripts use their own explicit contracts.
- `lib/jsx/serialize.ts` must preserve entity escaping and static template-literal children: SQL and
  CSS containing quotes, angle brackets or braces must survive repeated edit/serialize/parse cycles.
- Component names must agree between `component-names.ts`, `registry.ts` and JSX validation. Keep
  the names module free of React so server validation does not pull in the rendering graph.
- Preserve keys and node identity across updates, and never serialize generated `data-mx-*` or
  editing attributes as source.
- Grid geometry belongs to `grid-layout.ts`; edit and view placement must use the same arithmetic.
  Grid drag/resize writes source through `lib/data/story/jsx-edit.ts`. Slide discovery belongs to
  `lib/story-runtime/slides.ts`; previews must not introduce a second live data subscription.
- Floating UI must remain in the document's correct DOM/window. Do not reintroduce obsolete
  SVG/foreignObject positioning workarounds.
- `lib/story-ui/recipe-classes.ts` is generated: every string-literal token in `components/kit/`
  plus the files `EXTRA_CLASS_SOURCES` names, after comments are stripped. After touching those
  inputs run `npm run generate-story-ui-classes`; `recipe-classes.test.ts` fails when it is stale.
  `lib/data/story/typography.ts` supplies the editor's class vocabulary; the CSS union/version must
  change together so saved documents recompile.
- Verify parser/serialization, publish rejection, renderer defense, SSR/hydration and affected editing
  behavior. Use existing browser gates for geometry and real browser isolation, not DOM mocks alone.
