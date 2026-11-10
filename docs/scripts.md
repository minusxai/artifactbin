# Scripts

What each program under `scripts/` does and who runs it. Every file directly in `scripts/` and every
`scripts/ci/*.mjs` is named here; add a line in the same change as a new one. Libraries under `scripts/lib`,
`scripts/gates/lib` and `scripts/build` are read through the entry point that imports them.

**Run by** names the caller: an `npm run` script (root `package.json` unless a workspace is named), a workflow
(`.github/workflows/*.yml`), another script, an agent, or a person by hand.
`scripts/__tests__/script-paths.test.mjs` fails when a workflow or package script names a `scripts/` path that is
not in the tree.

Paths another repository runs, copies or imports are a contract: move them only with a paired change there.
artifactbin-server runs or imports `scripts/build/build-islands.mjs`, `scripts/build/html-core.mjs`,
`services/app/scripts/build-server-reader.mjs` and `services/app/testing/native-acceptance.mjs`; the evals
repository imports `scripts/lib/dev-env.mjs`, `scripts/lib/shard.mjs`, `scripts/lib/env.ts` and
`scripts/lib/slug.ts`. `services/app/__tests__/downstream-script-paths.test.ts` fails when one moves.

## Dev and agent tooling

| File | Purpose | Run by |
|---|---|---|
| `scripts/dev.mjs` | Full local composition (auth in front of the app, one process) on the port `.env` derives. | `npm run dev` |
| `scripts/dev-app.mjs` | The app alone, without login or OAuth. | `npm run dev:app` |
| `scripts/dev-otp.mjs` | Print a local login code from the protected dev outbox. | `npm run dev:otp -- <email>` |
| `scripts/setup.mjs` | Create or repair local settings (`.env`), planned by `scripts/lib/setup-plan.mjs`. | `npm run setup` |
| `scripts/port-block.mjs` | The next free 100-port block for a parallel dev server. | `scripts/agent-worktree.mjs`, by hand |
| `scripts/require-evals.mjs` | Stop `npm run eval` with the copy instruction when `evals/` is missing. | `npm run eval`, `npm run eval:report` |
| `scripts/agent-worktree.mjs` | Give a delegated agent a worktree, a port block in `.env` and its brief. | the orchestrating agent |
| `scripts/agent-dev-flow.mjs` | A disposable exercise of the agent check policy against fake remotes. | by hand |
| `scripts/register-yaml.cjs` | A `tsx -r` preload that lets Node import `.yaml` modules outside the bundler. | tests |

## Benchmarks (never run by CI; nothing asserts a budget)

| File | Purpose | Results |
|---|---|---|
| `scripts/resolver-latency.ts` | One trivial resolver call by stage, cold and warm, through the runner, its HTTP client and the dev app. | [resolver call latency](resolver-latency.md) |
| `scripts/dataset-read-latency.ts` | A repeated read of one stored dataset table through `executeCatalog` and the SQL worker pool, in process and over HTTP, as owner and as a filtered viewer. | [dataset read latency](dataset-read-latency.md) |
| `scripts/dataset-graphql-latency.ts` | Dataset GraphQL reads for an owner and a filtered viewer through the real route: statements per request, p50/p95 and peak RSS. | [dataset read latency](dataset-read-latency.md), "Dataset GraphQL" |

Run each with `node --import tsx <file>`; its header lists the options.

## Local checks and the pull request lane

| File | Purpose | Run by |
|---|---|---|
| `scripts/ci/check-local.mjs` | The FAST checks: `validate` and `test` (affected tests, within the file budget). | `npm run validate`, `npm test`, `ci.yml`, `pr-fast.yml` |
| `scripts/ci/check-ui-primitives.mjs` | Refuse controls, overlays and one-off styles drawn outside `services/app/solid/ui` (app chrome and the offline file's Solid chrome); ratchets debt in `scripts/ci/ui-primitives-allowlist.json` and requires a count and reason for each exception in `scripts/ci/ui-primitives-exceptions.json`. | `npm run validate` |
| `scripts/ci/module-graph.mjs` | Refuse import cycles, layer violations and deep imports between modules. | `npm run validate` |
| `scripts/ci/table-ownership.mjs` | Refuse writes to the artifacts, users and tokens tables outside their owning modules. | `npm run validate` |
| `scripts/ci/test-changed.mjs` | Discover the affected Vitest tests, enforce the 50-file budget, run them. | `npm test` |
| `scripts/ci/fast-check.mjs` | Parse every checked-in executable JavaScript file and run the fast module lane. | `pr-fast.yml`, `ci.yml` |
| `scripts/ci/fast-tests.mjs` | Audit full-suite ownership and enrolled tests' capabilities, then run the pure module tests. | `scripts/ci/fast-check.mjs` |
| `scripts/ci/observe-fast.mjs` | Publish the required `pr fast timing` status once a `pr fast` run completes. | `pr-fast-timing.yml` |
| `scripts/ci/merge-fast.mjs` | Squash-merge a pull request only after its exact completed `pr fast` attempt and timing pass. | agents, by hand (`node scripts/ci/merge-fast.mjs owner/repo PR`) |

`scripts/lib/ci-elapsed.mjs` measures the required-check chain's elapsed time for the job summary in both
`pr-fast.yml` and `ci.yml`.

## CI planning

| File | Purpose | Run by |
|---|---|---|
| `scripts/ci/ci.mjs` | GitHub adapter for the CI planner (`scripts/lib/ci-plan.mjs`): tested-tree plan, build key, lock fingerprint, roll-up. | `ci.yml`, `pr-fast.yml`, `page-speed.yml` |
| `scripts/ci/test-timings.mjs` | Refresh `scripts/ci/test-timings.json`, the per-file times test shards are packed by. | by hand, with a CI run id |

## Browser gates

| File | Purpose | Run by |
|---|---|---|
| `scripts/gates.mjs` | Run the journey gates as a set: servers, shards, and the bijection between gate files and the manifest. | `npm run test:gates`, `ci.yml` |
| `scripts/gates.manifest.mjs` | Each gate's mail use, serial group and timeout; a gate without a row, or a row without a file, fails. | `scripts/gates.mjs` |
| `scripts/gates.servers.mjs` | How many servers a gate run boots (the pure half). | `scripts/gates.mjs` |
| `scripts/gates.shard.mjs` | Split the gate set across CI runners (the pure half). | `scripts/gates.mjs` |
| `scripts/gates.process.mjs` | Run one gate process with its timeout and buffered output. | `scripts/gates.mjs` |
| `scripts/gate-container.mjs` | Run named gates in a Linux container, built and served as CI does. | agents and people, pre-merge only |
| `scripts/component-baseline-publish.mjs` | Publish the component catalogue to an isolated gate server and write the reader URL manifest. | `scripts/gates/gate-component-baseline.mjs` |

Each gate is `scripts/gates/gate-<name>.mjs`, and its header comment says what journey it covers; run one with
`node scripts/gate-container.mjs <name>`. `scripts/gates/lib/http-conformance.mjs` is the direct HTTP API
acceptance (bearer issuance, the signed-out refusal and the artifact API), run by
`services/app/__tests__/http-conformance.test.ts`.

## Build

| File | Purpose | Run by |
|---|---|---|
| `scripts/build/build-server.mjs` | Bundle a server entry into one ESM file with native packages external. | `npm run build`, `ci.yml`, `runner-design.yml` |
| `scripts/build/build-islands.mjs` | Compatibility entry that prepares native server reader assets. | downstream asset preparation |
| `scripts/build/build-html-components.mjs` | Build the HTML component module graph for the installed author skill. | by hand, when refreshing the skill bundle |
| `scripts/build/build-gate-inputs.mjs` | Build what the browser gates run: the app and the server bundle. | `ci.yml`, `scripts/gate-container.mjs` |

## Page speed (post-merge and manual)

`.github/workflows/page-speed.yml` runs on each push to main and by manual dispatch.

| File | Purpose |
|---|---|
| `scripts/ci/page-speed-scope.mjs` | Decide whether a change touches the page-speed lab's inputs. |
| `scripts/ci/page-speed-base.mjs` | Fetch the base revision's own measurement to compare against. |
| `scripts/ci/performance-loads.mjs` | The production-build lab: page loads and sizes into one JSON. |
| `scripts/ci/performance-report.mjs` | Head against base, as Markdown for the job summary and one JSON. |
| `scripts/build/size-targets.mjs` | Check a lab result against the size targets. |

## Generators

| File | Purpose | Run by |
|---|---|---|
| `scripts/render-schema.mjs` | Render the packages' tables into the bootstrap SQL files at the repo root. | `npm run render:schema` |
| `scripts/generate-env-snapshot.mjs` | Regenerate the `.env.example` snapshot inside `scripts/lib/setup-plan.mjs`. | `npm run generate:env-snapshot` |
| `scripts/design-systems.mjs` | Generate the design-system registry and agent references from `design-systems/specs`. | `npm run generate:design-systems` |
| `scripts/generate-design-system-previews.mjs` | Render the picker and docs thumbnails from the design-system covers. | `npm run generate:design-system-previews` |

## Worker isolation

| File | Purpose | Run by |
|---|---|---|
| `scripts/runner-os-boundary.mjs` | Verify the worker image's network, filesystem, privilege and resource restrictions. | `runner-design.yml` |
