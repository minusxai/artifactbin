# Report: back edges and the module-graph check

PR: https://github.com/minusxai/artifactbin/pull/464. One commit, empty body, single-line message, CLI bumped 0.4.51 → 0.4.52.

## How each edge was cut
| edge | how it was cut |
|---|---|
| `pkg/cli → app/server` | `team-application.ts` moved to `services/app/server/`. CLI `team-entry.startTeamHost` now takes the application as a parameter (`TeamApplication`). The new runtime entry `services/app/server/team-host.ts` composes the two and lazy-loads the app only after the operator env is installed, as before. `build-host.mjs` bundles that entry, and `bootstrap.cjs`'s `startTeamHost` keeps its name. |
| `lib/skills → pkg/cli` | `renderDoc`, `buildQuickSheet` and `QUICK_SHEET_MAX_BYTES` were only used by tests. They moved to `services/app/test/helpers/skill-docs.ts`, which is the only place that reads the CLI's `teaching.json`. 18 tests changed only their import. |
| `app/solid → lib/offline` | `previewWorkspaceUrl` (pure) moved to `services/contracts/src/preview-connect.ts`, next to the `PREVIEW_CONNECT_*` protocol. |
| `lib/story-runtime → app/solid` | The compiled-DOM editor (`dom-mounter.tsx`, `FlowEditor.tsx`, `GridEdit.tsx`, `rgl-kernel.ts`) imports only libs, so it moved down to `lib/story-runtime/edit/`. Its 3 tests moved with it as `*.ui.test.tsx`, which takes them from the shared `islands` project to the isolated `ui` project. `build-offline.mjs`'s Solid transform now also covers `lib/story-runtime/edit`. |
| `pkg/cli → scripts` | `npm-dependency-cache.mjs` and `npm-consumer-install.mjs` moved to `services/cli/scripts/`. The `ci.yml` run lines and seed cache key (`hashFiles`) changed, so the first run is one cold seed cache. Also updated: the `.ps1` line and the paths `ci-cache-contracts` expects. |
| `app/scripts ↔ scripts` | `precompress.mjs` and `.d.mts` moved to `services/app/scripts/`. Root `scripts`, `vite.config.mts` and `server-reader-cache` now point there. |
| `app/solid ↔ app/web` | The 8 web helpers that solid uses moved to `services/app/solid/lib/`. `web/` keeps the HTML entry, `solid-entry.tsx`, `restore-reader.ts` and the CSS. The 5 web tests stayed in `web/__tests__` with only their imports changed: moving them would have put non-isolated tests into the shared `islands` project (`artifact-view-report` keeps module state). |

New edges: `app/server → pkg/cli` (team-host and chromium). The CLI no longer reaches `app/server`, so this forms no cycle.

## Check (`scripts/ci/module-graph.mjs`, run by `npm run validate`)
- It has three separate parts: a scanner (`scanImports`, using the TypeScript AST), a graph (`moduleOf`, `resolveImport`, `buildModuleGraph`, `cyclesOf`) and a policy (`checkModuleGraph`, `recordAllowedCycles`). Nothing is cached.
- It enforces three rules:
  - Nothing in `ENTRY_OR_UI` may sit in a cycle, even if allow-listed.
  - Packages other than cli may import only `contracts`, `utils` or themselves.
  - Every edge inside a cycle must be in the allow-list, and an allow-list entry that is no longer cyclic fails, so the list can only shrink.
- Allow-list (`scripts/ci/module-graph.allowed-cycles.json`): it records **one cycle of 33 modules and 247 edges**. The 33 are `app-root` plus 32 `lib/*`.
- Runtime on a warm machine: about 1.06–1.3 s inside validate, and 1.19 s wall for the whole process.
- Test: `scripts/__tests__/module-graph.test.mjs`, written first. It ran red (module missing) and then green: 9 tests on small temporary git trees covering cycle detection, the allow-list passing, new edges, stale entries, entry/UI cycles and package rules. It also checks that the real repo passes.
- `AGENTS.md` gets a 4-line "Layers" rule under Working rules.

## What ran
- `npm run validate`: clean. This covers the residual-name guard, the module graph and the full type check.
- `npm test -- --files` with 31 files: 30 vitest files, 609 tests. The one failure was a too-broad assertion in my new test; I fixed it and reran. The CLI `team-entry.test.ts` passed: it boots a real team host through the new `app/server/team-host.ts`.
- Not run locally: bare `npm test`, gates, builds (build-offline, build-islands frame editor, CLI build-host) and the Windows `.ps1`. These are left to PR CI. I did not inspect CI before writing this.

## Not verified / notes
- `docs/editing.md:34` still names `solid/editor/FlowEditor.tsx`. That file is in the docs implementer's area, so I left it.
- The worktree's ports collided at 5000. The brief's 5200 block is taken by `reader-evidence`, so this worktree uses 5300–5399.
- The first CI run after merge will see a cold npm seed cache, because the cache key path changed.

## Default export freshness and table authoring

The seeded export contract was RED: `z.object(export_artifact.input).parse({ id, refresh: true })` returned only `{ id }`, dropping the refresh request before an agent could ask for a fresh image. The export operation now accepts `refresh: boolean`, documents it, and forwards true as the renderer's `refresh=1` value. Existing image caching is unchanged for ordinary calls.

The new route/operation test starts with a cached static document, applies a current-head edit that preserves the table/footer node IDs, and forces an export. It verifies the operation triggers a new capture, the capture URL selects the current head, and the raw route renders the updated footer. It then verifies a normal request reuses that image and another forced request renders again. The fixture has no data queries, so no SQL-cache behavior was changed.

Added short guidance for validating table totals against the named query's result column and row grain. The pinned `afbin help markup-data-authoring` copy assertion covers those instructions.

Checks: RED observed on the seeded test before implementation. GREEN on `npm run validate`; 6 Vitest files with 86 tests and 1 CLI file with 37 assertions/tests; local `npm run afbin -- help markup-data-authoring` on port 5401. `git diff --check` passed. No browser capture gate or production rendering was run; CI owns those checks.

Commit: `Fix fresh artifact export operation`.

===CONCISE===

Export operation refresh is explicit and honored; static current-head capture and ordinary cache reuse are covered. Table-total guidance is pinned in CLI help. FAST checks pass.

## Follow-up: reported stale `/export?refresh=1` image

The operation-level fake-PNG regression is insufficient to explain a stale raster. I ran a bounded one-off local route probe: it called `GET /a/<id>/export?format=png&refresh=1` after editing the published document, inspected the resulting capture URL, fetched that raw route through the real handler, rendered its returned HTML in local headless Chromium, and checked the returned PNG bytes. The fresh capture contained the edited `$12` footer and differed from the cached `$10` image.

Source inspection found no stale path in this local route: refresh forces a new export-cache image id; the raw markup response is `no-store`; the capture URL selects the current head; the local browser opens a fresh Playwright page per render; the export redirect and image response are also `no-store`. The probe used a test BrowserService adapter that fetched the raw handler and passed its HTML to Chromium, so it did not reproduce the deployed browser-service network path. It is evidence the application route/cache/source path works locally, not evidence the reported production symptom is fixed. Root cause remains unresolved pending a repro against the actual local composition or review of the exact production response path.

The Chromium probe was removed from the FAST Vitest suite because browser integration belongs to CI; the deterministic raw/cache regression remains. Fresh checks after removing it: not rerun (the prior 3/3 probe run included the removed Chromium case; the committed baseline's validation result remains from the earlier task).
