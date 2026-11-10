# Native HTML components

The `af-*` custom elements pages import as `@afbin/<name>`: their sources, `hosted.json` (what is served) and the
readable copies the skill ships. The reader build compiles them. Validation contracts that publish and the
renderer share live in `lib/html-component-specs`, not here.

## Rules
- A component is one flat lowercase file, `<name>.ts`, that calls `registerComponent` once at top level
  (`register-component.ts`), with `-model`/`-styles` siblings for logic and CSS. A public one is listed in
  `hosted.json` `components`; `legacy` is served only for pages that already load it and only shrinks.
- After any source edit run `npm run build:reader -w services/app`. It rebuilds the served modules (gitignored
  output) and rewrites the tracked readable copies in `services/app/skills/artifactbin/components/`: commit those
  regenerated files, never hand-edit them.
- Every readable source opens with a header comment and fits 200 lines of 100 columns
  (`services/app/lib/skills/__tests__/skill-code-shape.test.ts`): split a large component into siblings.
- Components ship to every page that imports them and this directory is browser-bundled code: import another lib
  module only through a leaf it lists in `scripts/ci/module-graph.mjs`, never its index; no `node:*`.
- Radii and colors resolve through the theme's CSS variables, with shipped fallbacks; `theme-contract.test.ts`
  pins the radius scale and the control, popup and overlay look in every theme.
- Shared component shape belongs in a spec file in `lib/html-component-specs` that both sides import, so the
  publish checks refuse what the element cannot draw.
- A reader or islands change ends with ONE run of `node scripts/gate-container.mjs kit-and-fonts`, at the end of
  the task, never per edit.

## Checks
- `npm test -- --files services/app/lib/html-components/button.test.ts services/app/lib/html-components/theme-contract.test.ts services/app/lib/libraries/__tests__/components.test.ts services/app/lib/libraries/__tests__/hosted-components.test.ts services/app/lib/skills/__tests__/skill-code-shape.test.ts`,
  with the edited component's own test file in place of `button.test.ts`.
- `npm run build:reader -w services/app`, then review the diff under `services/app/skills/artifactbin/components/`.
