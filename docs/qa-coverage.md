# QA coverage ownership

Use `npm run test:gates -- --list` for the current gate inventory. `npm test` runs the API,
Node, UI and CLI suites; CI shards the Vitest projects without running an additional duplicate
full-suite job. The `test` job aggregates results rather than executing tests again.

| Boundary | Owning checks | Why it remains |
| --- | --- | --- |
| Handler behavior, permissions, protocol errors | API tests against isolated state | Fast, deterministic request and response matrices |
| Parsing, policy, services, eval harness | Node tests | Detailed cases without app navigation |
| Component state and accessible interactions | UI tests | Isolated behavior; jsdom cannot establish geometry |
| Built app, actual input, layout and live updates | Browser gates | Bundling, browser layout, cookies, native clipboard and races |
| Full distribution image | Image job and layout gate against its container | Packaged dependencies and browser assets can differ from a local build |
| Split distribution images | Compose job: build, image-checks, boot, composition walk | Check contents, size and standalone behavior, then exercise those exact images together |
| CLI filesystem, executable discovery, PTY and packaged binary | Every supported CI OS/architecture | Native and shell behavior differs by platform |
| CLI pure authentication decisions and HTTP error translation | Ubuntu CLI row; full local CLI suite | These cases use injected behavior or a local HTTP fixture and need no platform matrix |
| Real agent comprehension of skills and transports | Conditional agent-smoke matrix | API tests do not prove an agent can follow the shipped instructions |
| Creative output comparison | Explicit eval runs | Comparison tasks are not per-PR merge checks |

## Consolidated ownership

| Former location | Current owner / retained evidence |
| --- | --- |
| `gate-viewport-units.mjs` | `gate-layout-shift.mjs` calls `lib/viewport-geometry.mjs`: viewport and half-viewport units, bounded document height, visible heading |
| `gate-data-table-height.mjs` | `gate-editable-table.mjs` calls `lib/table-geometry.mjs`: short-table fit, long-table cap and virtualized tail |
| `gate-web-import.mjs` | `gate-web-assets.mjs` owns image paint, source preservation and no-origin traffic; `lib/web-import-cases.mjs` retains font-family resolution and editor URL insertion |
| Broad app-flow raw/export/version/error matrices | `artifact-urls`, `export`, `manage`, `version-conflict`, `delete-protection`, `api` and `jsx-tier` API tests; dedicated export gate |
| Broad app-flow MCP CRUD/version matrix | Extended `mcp.test.ts` route roundtrip; app-flow retains built-server create/get |
| Data-ingest parsing, storage and Sheets matrices | `data-ingest-routes.test.ts` and data-ingest library tests; gate retains CSV-to-rendered-chart journey |
| Sheets gate fetch stub and its structural tests | Removed with its only consumer; API tests already provide scoped deterministic Sheets responses |
| `dataset-secret-boundary-review.test.ts` | Unique editable/public-sanitization case moved into `dataset-secret-boundary.test.ts`; duplicate cases removed |
| Home-page duplicate responsive menu check | Existing `topbar-nav.ui.test.tsx` owns the same PageMenu assertion |
| Separate lean-image job | Compose job runs image checks on the images it builds before `up --no-build` |

The app-flow smoke still checks every content tier's top-level HTML, missing-reference page serving,
and a real MCP create/get roundtrip. These assembled-server checks are not implied by handler tests.

## Deliberately separate

Do not merge pending-edit lifecycle checks into normal editor flow, agent/human draft races into
role demotion, dataset events into document events, or native clipboard paste into synthetic paste
solely because their names overlap. Each exercises a different failure boundary.

`node-identity` remains scheduled by the gate runner despite using HTTP: moving it to another runner
would change categorization without reducing execution, and the built-server boundary must remain.
`export-slice` exercises the server's browser exporter. Production composition checks belong to their
own repository; generic OSS service tests do not establish deployment policy.

All fetched/installed skill and API/MCP smoke treatments remain. Their task overlap is intentional:
the delivery or transport differs. Creative evals and documented manual probes are not unused CI
jobs. See [evals.md](evals.md) for selection, paid-run isolation and reporting rules.

The font-family browser case retains its existing live-provider limitation: it reports a skip if
Google cannot resolve the family. The deterministic local font-asset checks and API font tests still
run. No claim about live-provider availability follows from a unit-suite pass.

## Stable measurements

The version-coalescing test includes an explicit short-string collision and targets the paragraph
text with context, so generated IDs or unrelated attributes cannot make its edit ambiguous.
The editor gate reacquires a live fallback textarea if React replaces it during locator evaluation;
it still requires the same exact foreground/background colors. Empty computed styles from a detached
node are not measurements of the displayed editor.
