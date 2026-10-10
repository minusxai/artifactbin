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
workflow job (`ci.yml`, `page-speed.yml`), another script, an agent, or a person by hand. Paths a
downstream deployment runs (`gate-cli-conformance.mjs`, `build/build-islands.mjs`, `gates.mjs`,
`gate-container.mjs`, `ci/ci.mjs`) are a contract: move them only with a paired downstream change.

## Dev and agent tooling

| File | Purpose | Run by |
|---|---|---|
| `scripts/dev.mjs` | Full local composition (auth in front of the app, one process) on the port `.env` derives. | `npm run dev` |
| `scripts/dev-app.mjs` | The app alone, without login or OAuth. | `npm run dev:app` |
| `scripts/dev-otp.mjs` | Print a local login code from the protected dev outbox. | `npm run dev:otp -- <email>` |
| `scripts/setup.mjs` | Create or repair local settings (`.env`), planned by `lib/setup-plan.mjs`. | `npm run setup` |
| `scripts/afbin.mjs` | This branch's CLI against this checkout's dev server, state in `~/.artifactbin-dev/<port>`. | `npm run afbin -- <args>` |
| `scripts/port-block.mjs` | The next free 100-port block for a parallel dev server. | `agent-worktree.mjs`, by hand |
| `scripts/agent-worktree.mjs` | Give a delegated agent a worktree, a port block in `.env` and its brief. | the orchestrating agent |
| `scripts/agent-dev-flow.mjs` | A disposable exercise of the agent check policy against fake remotes. | by hand |

## Local checks

| File | Purpose | Run by |
|---|---|---|
| `scripts/ci/check-local.mjs` | The FAST checks: `validate` (names, types, module graph) and `test` (affected tests). | `npm run validate`, `npm test`, `ci.yml` |
| `scripts/ci/check-residual-names.mjs` | Refuse retired product names outside the allowlist. | `check-local.mjs validate` |
| `scripts/ci/module-graph.mjs` | Refuse import cycles and layer violations between modules. | `check-local.mjs validate` |
| `scripts/ci/test-changed.mjs` | Discover the affected Vitest and CLI tests, enforce the 50-file budget, run them. | `check-local.mjs test` |

## CI planning

| File | Purpose | Run by |
|---|---|---|
| `scripts/ci/ci.mjs` | GitHub adapter for the CI planner (`lib/ci-plan.mjs`): plan, build key, lock fingerprint, CLI bump, roll-up. | `ci.yml`, `page-speed.yml` |
| `scripts/ci/test-timings.mjs` | Refresh `ci/test-timings.json`, the per-file times test shards are packed by. | by hand, with a CI run id |
| `scripts/lib/ci-elapsed.mjs` | Measure the required-check chain's elapsed time for the job summary. | `ci.yml` |

## Browser gate runner

| File | Purpose | Run by |
|---|---|---|
| `scripts/gates.mjs` | Run the journey gates as a set: servers, shards, manifest bijection (`gates.manifest.mjs`). | `npm run test:gates`, `ci.yml`, downstream |
| `scripts/gate-container.mjs` | Run named gates in a Linux container built and served as CI does. | by hand, agents (pre-merge only) |

## Journey gates

One row per `gates/gate-<name>.mjs`; `gates.manifest.mjs` holds each gate's mail, serial group and timeout.
Run one with `node scripts/gate-container.mjs <name>`.

| File | Purpose | Run by |
|---|---|---|
| `scripts/gates/gate-accounts-and-workspace.mjs` | Guest start, OAuth consent, login, claim, fork, folders and CLI acceptance. | `gates.mjs` |
| `scripts/gates/gate-collab-roles.mjs` | Delivery follows the link's role for owner, signed-in stranger and visitor. | `gates.mjs` |
| `scripts/gates/gate-comments.mjs` | The owner pins feedback to a node; the agent answers. | `gates.mjs` |
| `scripts/gates/gate-data-journey.mjs` | A dataset becomes numbers on a page that re-runs its own queries. | `gates.mjs` |
| `scripts/gates/gate-datasets-in-documents.mjs` | Editable cells that write real rows, under every sharing permission. | `gates.mjs` |
| `scripts/gates/gate-editor-engine.mjs` | The editor engine end to end. | `gates.mjs` |
| `scripts/gates/gate-editor-exits.mjs` | Every way out of the editor, on desktop and phone. | `gates.mjs` |
| `scripts/gates/gate-editor-path.mjs` | The human path into and around the editor. | `gates.mjs` |
| `scripts/gates/gate-exports.mjs` | What the exporter photographs, checked as pixels. | `gates.mjs` |
| `scripts/gates/gate-inplace-edit.mjs` | Reading, editing, an agent write and exit on one document. | `gates.mjs` |
| `scripts/gates/gate-kit-and-fonts.mjs` | The component kit and its type; the compiled reader handover. | `gates.mjs` |
| `scripts/gates/gate-live.mjs` | Someone else writes and the open page follows without a reload. | `gates.mjs` |
| `scripts/gates/gate-media.mjs` | Files, images and web URLs from the author to a stranger's browser. | `gates.mjs` |
| `scripts/gates/gate-mermaid-prerender.mjs` | Published Mermaid diagrams draw from stored SVG that matches the engine. | `gates.mjs` |
| `scripts/gates/gate-offline-file.mjs` | The offline file and the screenshot comment in Chromium, Firefox and WebKit. | `gates.mjs` |
| `scripts/gates/gate-own-origin-script.mjs` | A script document on its own origin: framed, queried, edited, exported. | `gates.mjs` |
| `scripts/gates/gate-reader-shell.mjs` | Who is served what at `/a/<id>`. | `gates.mjs` |
| `scripts/gates/gate-reading-geometry.mjs` | Where a document sits, moves and scrolls at desktop and phone widths. | `gates.mjs` |
| `scripts/gates/gate-sessions.mjs` | Live browser sessions and test users through the real CLI. | `gates.mjs` |
| `scripts/gates/gate-viz-editor.mjs` | Building a chart by clicking. | `gates.mjs` |

## CLI conformance

| File | Purpose | Run by |
|---|---|---|
| `scripts/gate-cli-conformance.mjs` | The CLI's acceptance against a host, standalone (the `cli` leg of `gate-accounts-and-workspace`). | `services/cli/scripts/test-team-host.mjs`, downstream deployments |

## Build

| File | Purpose | Run by |
|---|---|---|
| `scripts/build/build-server.mjs` | Bundle a server entry into one ESM file with native packages external. | `npm run build`, `ci.yml`, `build-preview-gate-inputs.mjs` |
| `scripts/build/build-islands.mjs` | The shared reader island build and its manifest. | `npm run build:islands -w services/app`, `ci.yml`, downstream |
| `scripts/build/build-gate-inputs.mjs` | Build only what the browser gates run: app, server bundle, CLI bundle. | `ci.yml`, `gate-container.mjs` |
| `scripts/build/build-preview-gate-inputs.mjs` | Build the packaged preview runtime from already-built app assets. | `gates/gate-offline-file.mjs` |

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
| `scripts/register-yaml.cjs` | `tsx -r` preload that lets Node import `.yaml` modules outside the bundler. | `services/cli/scripts/generate-teaching.mjs`, `lib/afbin-run.mjs`, tests |

## Release

| File | Purpose | Run by |
|---|---|---|
| `scripts/bump-cli-version.mjs` | Bump the CLI release version (patch, minor or major). | `npm run release:cli`, `release-afbin.yml` |
| `scripts/ci/npm-provenance.mjs` | Sign and verify the CLI tarball's build provenance. | `ci.yml` (`cli-pack`), `release-cli.yml` |
| `scripts/lib/ci-artifact-wait.mjs` | Wait for and extract this run's release artifacts for native acceptance. | `ci.yml` |
| `scripts/ci/link-npm-acceptance.mjs` | Link the native acceptance tooling's `node_modules`. | `ci.yml` |
| `scripts/ci/linux-acceptance-deps.mjs` | Cache the Linux acceptance job's downloaded deb archives. | `ci.yml` |

## Operator scripts

| File | Purpose | Run by |
|---|---|---|
| `scripts/compiled-backfill.ts` | Recompile selected stored document versions on a running server. | an operator, by hand |
