# scripts/

Every program under `scripts/`: what it does and who runs it. Files that only other files import
(`lib/`, `gates/lib/`, `build/runtime-externals.mjs`, `gates.manifest.mjs`, ...) are libraries and have
no row; read the entry point that imports them.

An **entry point** is a code file under `scripts/` (outside `__tests__/` and `fixtures/`) that a
package.json script or a workflow step runs, that starts with a shebang, or that no other non-test file
imports. `scripts/__tests__/scripts-index.test.mjs` derives that set from the tree and fails when a
program has no row here or a row names a file that is gone or is now only a library: add the row in the
same change as the file.

**Run by** names the caller: an `npm run` script (root `package.json` unless a workspace is named), a
workflow job (`ci.yml`, `page-speed.yml`), another script, an agent, or a person by hand.
`scripts/__tests__/script-paths.test.mjs` fails when a workflow or package script names a `scripts/` path
that is not in the tree.

Paths another repository runs, copies or imports are a contract: move them only with a paired change
there. artifactbin-server runs or sparse-checks-out `lib/ci-plan.mjs`, `lib/ci-artifact-wait.mjs`,
`lib/ci-elapsed.mjs`, `ci/ci.mjs`, `ci/npm-provenance.mjs`, `ci/npm-driver.mjs`,
`ci/link-npm-acceptance.mjs`, `ci/npm-acceptance/`, `gate-cli-conformance.mjs` and
`build/build-islands.mjs`; the evals repository imports `lib/dev-env.mjs`, `lib/shard.mjs` and
`lib/{credential,env,slug}.ts`, and mirrors `lib/dev-runner.mjs`. Where each is used, and the check that
fails when one moves: `services/app/__tests__/downstream-script-paths.test.ts`.

## Dev and agent tooling

| File | Purpose | Run by |
|---|---|---|
| `scripts/dev.mjs` | Full local composition (auth in front of the app, one process) on the port `.env` derives. | `npm run dev` |
| `scripts/dev-app.mjs` | The app alone, without login or OAuth. | `npm run dev:app` |
| `scripts/dev-otp.mjs` | Print a local login code from the protected dev outbox. | `npm run dev:otp -- <email>` |
| `scripts/setup.mjs` | Create or repair local settings (`.env`), planned by `lib/setup-plan.mjs`. | `npm run setup` |
| `scripts/port-block.mjs` | The next free 100-port block for a parallel dev server. | `agent-worktree.mjs`, by hand |
| `scripts/require-evals.mjs` | Stop `npm run eval` with the copy instruction when `evals/` is missing. | `npm run eval`, `npm run eval:report` |
| `scripts/agent-worktree.mjs` | Give a delegated agent a worktree, a port block in `.env` and its brief. | the orchestrating agent |
| `scripts/agent-dev-flow.mjs` | A disposable exercise of the agent check policy against fake remotes. | by hand |

## Local checks

| File | Purpose | Run by |
|---|---|---|
| `scripts/ci/check-local.mjs` | The FAST checks: `validate` (names, types, module graph) and `test` (affected tests). | `npm run validate`, `npm test`, `ci.yml` |
| `scripts/ci/check-residual-names.mjs` | Refuse retired product names outside the allowlist. | `check-local.mjs validate` |
| `scripts/ci/check-ui-primitives.mjs` | Refuse controls, overlays and one-off styles drawn outside `services/app/solid/ui` (app chrome in `solid/` and the offline file's `lib/offline/*.tsx`); ratchets migration debt in `ui-primitives-allowlist.json` and requires an exact count and a `reason` for each permanent exception in `ui-primitives-exceptions.json`. | `check-local.mjs validate` |
| `scripts/ci/module-graph.mjs` | Refuse import cycles and layer violations between modules. | `check-local.mjs validate` |
| `scripts/ci/fast-check.mjs` | Parse executable JavaScript and run the fast module lane. | post-merge `ci.yml` on main |
| `scripts/ci/fast-tests.mjs` | Audit full-suite ownership and enrolled tests' transitive capabilities, then run pure module behavior. | `fast-check.mjs` |
| `scripts/ci/test-changed.mjs` | Discover the affected Vitest tests, enforce the 50-file budget, run them. | `check-local.mjs test` |

## CI planning

| File | Purpose | Run by |
|---|---|---|
| `scripts/ci/ci.mjs` | GitHub adapter for the CI planner (`lib/ci-plan.mjs`): plan, build key, lock fingerprint, roll-up. | `ci.yml`, `page-speed.yml` |
| `scripts/ci/prepare-esbuild.mjs` | Build pinned-source compilers with the secured Go toolchain and verify every installed package executable. | root `postinstall`, `ci.yml`, `page-speed.yml`, `runner-design.yml` |
| `scripts/ci/npm-provenance.mjs` | Sign and verify the CLI retirement tarball's build provenance. | `ci.yml` (`cli-pack`), `release-cli.yml`, artifactbin-server CI |
| `scripts/ci/test-timings.mjs` | Refresh `ci/test-timings.json`, the per-file times test shards are packed by. | by hand, with a CI run id |
| `scripts/lib/ci-elapsed.mjs` | Measure the required-check chain's elapsed time for the job summary. | `ci.yml` |
| `scripts/lib/ci-supersede.mjs` | Cancel a pull request's earlier, unfinished CI runs without making the new run wait for them. | `ci.yml` (`supersede`) |

## Browser gate runner

| File | Purpose | Run by |
|---|---|---|
| `scripts/gates.mjs` | Run the journey gates as a set: servers, shards, manifest bijection (`gates.manifest.mjs`). | `npm run test:gates`, `ci.yml` |
| `scripts/gate-container.mjs` | Run named gates in a Linux container built and served as CI does. | by hand, agents (pre-merge only) |
| `scripts/component-baseline-decode.mjs` | Decode captured component-baseline evidence for review. | by hand, with a capture directory |

## Journey gates

One row per `gates/gate-<name>.mjs`; `gates.manifest.mjs` holds each gate's mail, serial group and timeout.
Run one with `node scripts/gate-container.mjs <name>`.

| File | Purpose | Run by |
|---|---|---|
| `scripts/gates/gate-accounts-and-workspace.mjs` | Guest start, OAuth consent, login, claim, fork and folders. | `gates.mjs` |
| `scripts/gates/gate-collab-roles.mjs` | Delivery follows the link's role for owner, signed-in stranger and visitor. | `gates.mjs` |
| `scripts/gates/gate-comments.mjs` | The owner pins feedback to a node; the agent answers. | `gates.mjs` |
| `scripts/gates/gate-component-baseline.mjs` | Verify the reader's component asset and baseline evidence. Native migration pilots use exact local app/reader trustworthy origins for production-equivalent secure-context APIs and record `browser-context.json` on both sides. | `gates.mjs` |
| `scripts/gates/gate-data-journey.mjs` | A dataset becomes numbers on a page that re-runs its own queries. | `gates.mjs` |
| `scripts/gates/gate-datasets-in-documents.mjs` | Editable cells that write real rows, under every sharing permission. | `gates.mjs` |
| `scripts/gates/gate-exports.mjs` | What the exporter photographs, checked as pixels. | `gates.mjs` |
| `scripts/gates/gate-kit-and-fonts.mjs` | The component kit and its type; the compiled reader handover. | `gates.mjs` |
| `scripts/gates/gate-live.mjs` | Someone else writes and the open page follows without a reload. | `gates.mjs` |
| `scripts/gates/gate-html-components.mjs` | Check the HTML component author and reader contract. | `gates.mjs` |
| `scripts/gates/gate-html-rich-components.mjs` | Check rich HTML component content through publication and reading. | `gates.mjs` |
| `scripts/gates/gate-native-core.mjs` | Immediate reader, lazy author import, trusted relay and self-contained offline client behavior. | `gates.mjs` |
| `scripts/gates/gate-presence.mjs` | Reader cursors, selections and preferences stay isolated across accounts and tabs on the shared document stream. | `gates.mjs` |
| `scripts/gates/gate-private-preview-save.mjs` | Save a private preview and verify its reader handover. | `gates.mjs` |
| `scripts/gates/gate-media.mjs` | Files, images and web URLs from the author to a stranger's browser. | `gates.mjs` |
| `scripts/gates/gate-offline-file.mjs` | The offline file and the screenshot comment in Chromium, Firefox and WebKit. | `gates.mjs` |
| `scripts/gates/gate-own-origin-script.mjs` | A script document on its own origin: framed, queried, edited, exported. | `gates.mjs` |
| `scripts/gates/gate-reader-shell.mjs` | Who is served what at `/a/<id>`. | `gates.mjs` |
| `scripts/gates/gate-reading-geometry.mjs` | Where a document sits, moves and scrolls at desktop and phone widths. | `gates.mjs` |

## CLI conformance

| File | Purpose | Run by |
|---|---|---|
| `scripts/gate-cli-conformance.mjs` | A released CLI executable's acceptance against a host, standalone. | artifactbin-server CI |

## Build

| File | Purpose | Run by |
|---|---|---|
| `scripts/build/build-server.mjs` | Bundle a server entry into one ESM file with native packages external. | `npm run build`, `ci.yml` |
| `scripts/build/build-html-components.mjs` | Build the HTML component module graph for the installed author skill. | by hand, when refreshing the skill bundle |
| `scripts/build/build-islands.mjs` | The shared reader island build and its manifest. | `npm run build:islands -w services/app`, `ci.yml`, downstream |
| `scripts/build/build-gate-inputs.mjs` | Build what the browser gates run: the app and the server bundle. | `ci.yml`, `gate-container.mjs` |

## Page speed

| File | Purpose | Run by |
|---|---|---|
| `scripts/ci/page-speed-scope.mjs` | Decide whether a pull request touches the page-speed lab's inputs. | `page-speed.yml` |
| `scripts/ci/page-speed-base.mjs` | Fetch main's own measurement as the pull request's base. | `page-speed.yml` |
| `scripts/ci/performance-loads.mjs` | The production-build lab: page loads and sizes into one JSON. | `page-speed.yml` |
| `scripts/ci/performance-report.mjs` | Head against base, as Markdown for the job summary and one JSON. | `page-speed.yml` |
| `scripts/build/size-targets.mjs` | Check a lab result against the phase 2 size targets. | `page-speed.yml` |

## Generators and loaders

| File | Purpose | Run by |
|---|---|---|
| `scripts/render-schema.mjs` | Render the packages' tables into the bootstrap SQL files at the repo root. | `npm run render:schema` |
| `scripts/generate-env-snapshot.mjs` | Regenerate the `.env.example` snapshot inside `lib/setup-plan.mjs`. | `npm run generate:env-snapshot` |
| `scripts/design-systems.mjs` | Generate the design-system registry and agent references from `design-systems/specs`. | `npm run generate:design-systems` |
| `scripts/generate-design-system-previews.mjs` | Render the picker and docs thumbnails from the design-system covers. | `npm run generate:design-system-previews` |
| `scripts/register-yaml.cjs` | `tsx -r` preload that lets Node import `.yaml` modules outside the bundler. | tests |
| `scripts/lib/native-migration-disposable-provider.ts` | Open a reviewed disposable migration lifecycle with isolated local storage. | Migration lifecycle adapter configuration |
| `scripts/lib/native-migration-production-authority.ts` | Prepare and verify reviewed production migration authority bindings. | Migration operator preparation |
| `scripts/migration_batch/reader-preflight.mjs` | Verify sealed reader inputs and expected bindings before apply, then actual receipt scope before preservation readback. | Reviewed migration host jobs |
| `scripts/migration_batch/refresh-selection.mjs` | Create an immutable current-source selection for the same agreed artifact IDs with verified source identity and provenance. | Reviewed migration preparation |
| `scripts/native-migration-production.mjs` | Plan or apply a reviewed latest-head migration using explicit operator approvals. | Migration operator |
| `scripts/lib/native-migration-camera.mjs` | Adapt reviewed source-bound recipes to the existing migration capture and comparison contract. | Migration verification callers |

## Downstream release tooling

Kept for artifactbin-server's CI (see the contract above); nothing in this repository's CI runs them.

| File | Purpose | Run by |
|---|---|---|
| `scripts/lib/ci-artifact-wait.mjs` | Wait for and extract a run's artifacts. | artifactbin-server CI |
| `scripts/ci/link-npm-acceptance.mjs` | Link the native acceptance tooling's `node_modules`. | artifactbin-server CI |


For disposable migration QA across mapped owners, set the lifecycle configuration's `runtimeAuthority` to `{mode: "disposable-scoped-tokens", ttlMs: 3600000}`. Set the pipeline authority runtime to the same mode and map each reviewed source owner to `{userId: targetUserId}`; omit token IDs. The local provider provisions credentials after the reviewed identities exist, preserves source token provenance, and revokes its credentials on cleanup. This mode requires local PGlite and local object storage. The private `runtime-actors.json` cleanup receipt contains token ID hashes and expiry/revocation state, never bearer credentials.
