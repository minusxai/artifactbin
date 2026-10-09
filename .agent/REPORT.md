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

Source inspection found no stale path in this local route: refresh forces a new export-cache image id; the raw markup response is `no-store`; the capture URL selects the current head; the local browser opens a fresh Playwright page per render; the export redirect and image response are also `no-store`. The probe used a test BrowserService adapter that fetched the raw handler and passed its HTML to Chromium, so it did not reproduce the deployed browser-service network path. A subsequent local-dev end-to-end check below used the real composition and CLI.

The Chromium probe was removed from the FAST Vitest suite because browser integration belongs to CI; the deterministic raw/cache regression remains. Fresh checks after removing it: not rerun (the prior 3/3 probe run included the removed Chromium case; the committed baseline's validation result remains from the earlier task).

### Full local-dev composition, 2026-10-09

Used `APP__PORT=5401 npm run dev`, authenticated a disposable `mxmx_test` local account through `afbin auth` and `npm run dev:otp`, and created/pushed the `$10` table fixture with `afbin push`. A real CLI export of the artifact URL produced the initial `$10` PNG. After editing and pushing v2 with `$12`, an ordinary export of the URL returned the old `$10` PNG (SHA-256 `f9f22e90b49513548c17ab624148e39e39244ab5d64515c4dcbbad83a791f798`), while `afbin export 4Ihagf --refresh` and `afbin export <full artifact URL> --refresh` both returned the `$12` PNG (SHA-256 `60b0fbf99c3e1e7f333ece4763384ffef8caca605e7ac39f99d08e5ac3a9bb38`). The four PNGs are in `tmp/export-refresh-live/` and were inspected. This used the actual app, browser-service HTTP navigation, export route, signed asset redirect, and CLI response path. The local artifact was soft-deleted after the check; the dev server was stopped.

The original production report was specifically about a URL containing `refresh=1`; that forced-refresh symptom did not reproduce in this worktree, even though the ordinary unrefreshed image was stale immediately after the edit. I found no source difference explaining why the deployed forced refresh returned old pixels. Treat the original production cause as unresolved; local evidence establishes only that the full local forced-refresh path returns the current image.

## Public default-request authority and annotation lifecycle companion

Commits: `4a006bee` (22 files) and `bf4ba122` (ordinary completion isolation follow-up). This section records only this implementer's checks; earlier report sections belong to other workstreams.

The owning account module now reads live owner-bound token metadata, including a server-minted `request_authority` marker. Marked credentials require the hosted authorization hook and fail closed if it is missing, unavailable, malformed, or returns an ordinary classification. Unmarked human/native credentials retain ordinary admission without depending on hosted service availability. Deployment extensions can mark their own existing grant namespace via `markRequestAuthority(prefix,q)`; public code never parses private grant names. Browser/agent-cookie actor identity retains its original token ID; direct HTTP and browser requests pass distinct authority sentinels. Actual operation admission occurs before durable mutation receipts. Definitive403 refusal includes `admission_refused:true`, while deferred202 replies claim neither annotation rows nor mutation receipts. Successful scoped operations report returned resources to the private grant owner.

Cancellation revokes new admissions. Previously admitted effects may finish and committed writes remain; the test deliberately admits a write before cancellation then refuses a duplicate/new admission. No rollback or cross-service atomic lock is claimed. Conversation history is retained. `cancelled` is a terminal shared work phase and displays `Cancelled`. Blocked/cancelled/obsolete callback retries cannot resurrect superseded work or duplicate clarification prose. A real human follow-up handler supersedes a blocked request before a lost-response retry.

Default annotation connection/activity use a readonly status snapshot refreshed outside annotation assembly transactions; projection inside `work(tx)` has no external IO and never calls ensure. Snapshot failure/expiry does not claim online. Annotation reads carry generation/sequence guards so an older initial/poll response cannot replace a newer live or local snapshot.

Observed RED: actual-owned-thread authority tests3 failures/1 pass (old writes accepted200); HTTP/browser escape2 failures/4 passes; missing-hook1 failure/6 passes; stale initial annotation response1 failure/28 passes; cancelled presentation1 failure/38 passes; blocked retry1 failure/7 passes. The first stale-response fixture mistakenly resolved the resolved-history read and passed; it was corrected to isolate the initial open-list response before the meaningful failure was observed.

Fresh FAST: `npm run validate` passed (module graph57 modules and TypeScript); selected10 files144 tests passed: hosted-request-scope, hosted-comments, annotations UI, remote-reply, schema-ownership, schema-sql-fresh, hosted-agent-client, remote-review, document-operations, annotations-events. Subsequent ordinary-completion isolation check passed12 tests in hosted-request-scope plus fresh validate. No bare test, gate, full build, CI push, production mutation, or CLI version bump was performed by this implementer. Root owns the separate CLI admission-refusal consumer and final release/CI.

Running app: own dev5001, local disposable email login via protected `npm run dev:otp`, published artifact `OuLTHK`, and normal `afbin sessions script` visually rendered shell/document. Screenshot `local-ui-render.png` and receipt `local-ui-proof.json` retained. Comment-save attempts in a bearer/agent-cookie browser did not expose a composer; no successful human UI write is claimed. The dev OSS entry point does not install the optional default hosted composition, so unused signed fixture5027 was stopped and exact prior `.env` restored. Browser session closed normally; dev server session16104 remains available for root. Full default/native readiness browser acceptance is left to the composed CI artifact and production confirmation owned by root.

===CONCISE===

Scoped default authority fails closed before admission; ordinary tokens stay independent. Cancellation and blocked delivery are terminal; stale annotation responses cannot replace newer snapshots. Actual-owned-handler and compatibility regressions pass; readonly default snapshot avoids ensure inside annotation transactions. Commits4a006bee+bf4ba122. Local shell/document render passed; human comment-save/default-composed UI not claimed. Dev5001 retained; browser and unusedfixture cleaned.

## Browser request scope companion, 2026-10-09

A browser session stores the trusted opaque request scope at creation. Every script checks exact scope equality after owner verification and before lease touch, viewer conflict, execution-receipt lookup or worker invocation. This includes `create:true` collisions and script receipt retries. Legacy undefined scopes match only undefined. Same-owner credential rotation within the same scope resumes normally; owner status/close retain existing cleanup behavior. Existing sessions are never relabeled.

The app copies scope from the authenticated allowed-authority decision into `OpContext` and then the service request. Caller operation input is stripped and cannot override it. A scoped browser script without a nonempty scope, or with malformed/blank/oversized scope, fails403 with definitive `admission_refused:true` before reaching the browser service. Ordinary sessions remain unscoped and independent of hosted authority.

Observed RED: seeded actual BrowserSessions regression1failed/9passed. App propagation test first ran while source was changing and passed; this was not treated as baseline RED. I then deliberately removed the trusted HTTP→OpContext propagation from the passing implementation:1failed/12passed, expected trusted-A but got undefined; restored it before final verification (Blue→Red→Blue). Final FAST: `npm run validate` passed; `npm test -- --files services/browser/__tests__/sessions.test.ts services/app/__tests__/testusers-sessions.test.ts services/app/__tests__/hosted-request-scope.test.ts` passed3files37tests. `git diff --check` passed. An initial selected command mistakenly named nonexistent utils browser.test.ts and exited2 with no successful verification; corrected to the actual three affected test files. No full suites, gates, local builds, pushes, production actions, browser/provider resources, or development servers were started for this boundary-only brief.

Evidence: `.agent/scope-red.log`, `.agent/app-propagation-red.log`, `.agent/final-scope-green.log`, `.agent/final-scope-validate.log`; copied to the stress task's `evidence/public-browser-scope`. Private A was notified of the stable source snapshot for integrated service/worker coverage. Root owns compiled artifact and deployment acceptance.

===CONCISE===

Browser scopes cannot be forged or relabeled through existing-session creation/replay. Ordinary sessions, owner cleanup, and same-scope credential rotation remain compatible. Genuine browser RED and app Blue→Red→Blue observed; validate+3files37tests passed. No resources or production changes.

## Generic blocked readiness label

Changed the shared connected-agent formatter from `Online · Waiting for approval` to `Online · Waiting for input`. Both roster/sidebar and terminal header use the same formatter. This accurately covers default clarification questions and native permission prompts without asserting that approval was requested.

Observed actual RED after seeded expectations: chat-page1failed/36passed, unable to find the expected Waiting for input header. After the one-line change, fresh `npm run validate` passed and `npm test -- --files services/app/solid/__tests__/chat-page.test.tsx` passed37/37. `git diff --check` passed. No development servers, browser sessions or provider fixtures were started; exact blocked production UI confirmation is parent-owned after deployment. No push, local build, SLOW gate or production operation was performed.

===CONCISE===

Shared blocked status now says Waiting for input. Genuine RED→GREEN:1/36 to37/37; validation clean. No owned resources to clean up. Parent owns CI and deployed confirmation.

## Plain human replies to blocked clarification

The annotation transaction now infers a recipient only for a nonempty, unmentioned HUMAN reply (never the thread root) and only when the same owner/artifact/thread has exactly one active comment-capable agent whose latest admitted work is blocked. Sequence chronology, not recently updated timestamps, excludes older blocked rows behind completed, failed, cancelled or pending requests. Explicit mentions remain authoritative; raw Shell, other owners/artifacts/threads, inactive agents and ambiguous recipients are excluded. Native harnesses share this contract.

Admission locks the selected agent and rechecks eligibility. Existing work for the same saved comment is recognized before supersession, so retries cannot duplicate the queue row or supersede a later blocked clarification. Queue-full inference records the refusal while preserving the blocked assignment; that refused work is not a newer admitted request, allowing a later answer after capacity frees. Explicit queue behavior otherwise retains its existing supersession semantics.

Observed actual-handler RED1failed/36passed: the human reply persisted but work count remained1 instead of2. After inference, actual handler queues the plain answer, native relay delivers exactly one request, acknowledgment removes it, and replaying the saved comment remains idempotent after a later blocked result. Additional latest-work/queue-full tests observed genuine RED5failed/58passed before their fixes. One interim fixture import mistakenly used an unexported contracts subpath and collected zero tests; corrected to the existing source contract import before behavioral RED was recorded.

Final fresh FAST: `npm run validate` passed; `npm test -- --files services/app/__tests__/remote-review.test.ts services/app/__tests__/remote-sessions.test.ts services/app/__tests__/hosted-comments.test.ts services/app/__tests__/annotations-events.test.ts` passed4files91tests; `git diff --check` passed. Tests include Claude/Codex/Pi/OpenCode, all excluded phases, scope boundaries, explicit/ambiguous recipients, replay and capacity recovery. No servers, browser/provider resources, SLOW gates, builds, pushes or production mutations were performed. Root owns exact deployed acceptance.

===CONCISE===

Plain answers resume only the sole latest-blocked owned recipient in that thread. Explicit targets override inference; duplicate admission and queue refusal are safe. Actual-handlerRED plus5edge-caseRED observed; validation+4files91tests passed. No resources remain.
