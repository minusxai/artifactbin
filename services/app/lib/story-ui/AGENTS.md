# Markup and story UI

These rules cover `lib/story-ui` and the parser in `lib/jsx`. Read the root
[AGENTS.md](../../../../AGENTS.md) and [design notes](../../../../docs/design-notes.md) for shared rules.

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
- `StoryRuntimeApp` is the shared SSR/hydration composition. Editing is a mode of the served document,
  not a second canvas. Persistent node IDs and transient AST paths have different jobs; preserve keys
  and identity across updates and never serialize generated `data-mx-*` or editing attributes as source.
- Author scripts run in a separately sandboxed frame via `lib/story-runtime/author-script.ts` and its
  bridge/bootstrap. Keep the opaque origin, CSP, channel validation and realm lockdown. Do not give
  author code the parent DOM, arbitrary network access or application credentials.
- Grid geometry belongs to `grid-layout.ts`; edit and view placement must use the same arithmetic.
  Grid drag/resize writes source through `lib/data/story/jsx-edit.ts`. Slide discovery belongs to
  `lib/story-runtime/slides.ts`; previews must not introduce a second live data subscription.
- Floating UI must remain in the document's correct DOM/window. App chrome uses the shared
  `components/Tooltip.tsx`. Do not reintroduce obsolete SVG/foreignObject positioning workarounds.
- `recipe-classes.ts` is generated from string literals in kit and embed source after stripping comments.
  After touching those inputs, run `npm run generate-story-ui-classes`. `lib/data/story/typography.ts` supplies the
  editor's class vocabulary; the CSS union/version must change together so saved documents recompile.
- Verify parser/serialization, publish rejection, renderer defense, SSR/hydration and affected editing
  behavior. Use existing browser gates for geometry and real browser isolation, not DOM mocks alone.
