# App UI

The Solid app: shell, pages, document chrome, editors and their tests. Every control, overlay and surface is
drawn by `ui/` and composed everywhere else. Document content (the reader kit and the page runtime) is not app
chrome and follows its own rules.

## Rules
- Compose `ui/`: `ui/Button.tsx` (with `href` for a link drawn as a control), `ui/Select.tsx`, `ui/Dialog.tsx`,
  `ui/Menu.tsx`, `ui/Tabs.tsx`, `ui/Disclosure.tsx`, `ui/Field.tsx` and the rest. `md` is form density, `sm`
  chrome density (`ui/control-styles.ts`). Use the theme tokens in `services/app/app/globals.css`
  (`rounded-chip|control|panel|dialog`, `text-micro|2xs`, `h-control*`, theme colors), never arbitrary values,
  hex or palette colors.
- `scripts/ci/check-ui-primitives.mjs` (in `npm run validate`) refuses hand-rolled controls, overlays and
  one-off styles. Its allowlist (`scripts/ci/ui-primitives-allowlist.json`) is
  empty and may only shrink; `scripts/ci/ui-primitives-exceptions.json` is for
  colors that are data, each with a reason. Never add an entry to pass the check.
- A missing look or behavior is added to `ui/`: the component or variant, shown on `pages/UiGallery.tsx`
  (`/dev/ui`, development only, every size, variant and state in light and dark) and tested in
  `ui/__tests__`. Modules outside `ui/` never import `ui/control-styles.ts`; `ui/` exports components, not
  class strings.
- Tooltips use `ui/Tooltip.tsx`, never a `title` attribute (iframes excepted).
- UI tests find elements by role and accessible name, the way a person or screen reader does, not by class,
  test id or DOM shape.
- Imports are top-level except intentional lazy chunks: a page, dialog or tool not needed for first paint loads
  through `lazy(() => import(...))` or a dynamic import, as `App.tsx` and `pages/Document.tsx` do, with a comment
  saying why. A static import from the shell adds to the app shell's JS before the document frame, which the
  page-speed lab budgets after merge.
- This is browser-bundled code: take a lib module's values from the leaves its `scripts/ci/module-graph.mjs`
  row lists, never a server-only entry.

## Checks
- `npm run validate` (the UI-primitive guard and the module graph).
- `npm test -- --files services/app/solid/ui/__tests__/controls.test.tsx services/app/solid/ui/__tests__/overlays.test.tsx services/app/solid/ui/__tests__/tooltip-lifecycle.test.tsx`, plus the edited area's own `__tests__` files.
- See a change on `/dev/ui` and the affected page in this worktree's `npm run dev`.
