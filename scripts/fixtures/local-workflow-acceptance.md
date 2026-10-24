# Local workflow acceptance

These checks target one exact, combined, built candidate on loopback. A syntax check or unit test is not a browser receipt. Existing deployed comment receipts are historical regression evidence, not proof of the new local workflow. No migration or production mutation belongs to this acceptance.

## Inputs and safety

Use disposable normal accounts and fresh fixture IDs. Keep the manifest, browser storage state, downloaded HTML, request bundles and evidence outside git. Record source revision and built asset hashes. Serve author HTML on its intended file/runner origin; never inject a platform cookie into page JavaScript. A private file must not gain account authority merely because a platform session exists. Do not log capabilities, cookies or signed URLs.

The executable smoke accepts only a loopback origin. Start the actual combined app using its owned port/data directory. Download one unlisted HTML file and one private HTML file normally as their owner; place their paths in a private manifest. Create normal Playwright storage state for that same disposable owner. No fake broker/GraphQL responses, injected grants, stubbed login, or browser `postMessage` simulations count.

```sh
node scripts/fixtures/local-workflow-browser.mjs
node scripts/fixtures/local-workflow-browser.mjs --execute /absolute/private/manifest.json
```

Required manifest fields: `candidate` (40-character revision), `origin`, `playwrightModule` (absolute installed module entry), `linkedFile`, `privateFile`, `accountStorageState`, `output`. The output is exclusive-created and starts incomplete. This script covers the first four portable rows only; it does not claim the whole matrix passed.

## Matrix

| Scenario | Actual action | Required evidence |
| --- | --- | --- |
| Linked guest auto-connect | Open downloaded unlisted HTML directly as `file://` in empty browser context | Original URL unchanged; actual platform broker iframe and original controls appear; connected guest has no implicit account approval |
| Save versus disk | Controls → Save linked HTML → choose current file | Actual browser download, linked metadata retained, original disk bytes identical; offline reopen uses downloaded copy |
| Private first sign-in | Open private file without platform session | Sign in offered; normal platform auth/window and explicit approval, no author-origin credentials |
| Explicit account approval | Open private file with normal ambient session | Permission required before click; Connect this file → connected; account authority remains in platform broker |
| Source mismatch | Edit authored HTML while keeping linked identity; separately advance remote head | Visible mismatch/stale status; no remote query/mutation admitted; local content remains usable; no automatic overwrite or replacement |
| Private loopback preview | Run downloaded `scripts/preview.mjs PROJECT --port PORT` with linked entry | Private marker exists before first author script; no platform broker/remote resource request; local runtime comes from archive |
| Disk change | Change relative CSV/JSON or atomic-replace entry while preview open | File changed notice, current DOM/state unchanged until explicit Reload; reload consumes new bytes and retains only contract-persisted viewer state |
| Local dataset state | Relative CSV link; real client schema/rows/mutation query | Actual parser/executor rows, local viewer state update; refresh semantics and original disk unchanged; no remote backend |
| Dependency publication | `publication-bundle.mjs ROOT ENTRY SERVER REQUEST`; inspect saved request then `--send REQUEST` | Original local image/CSS/module/CSV resolve after publication; scoped child bytes work for authorized private page; unauthorized direct child denied; idempotent same request/key no duplicates |
| Downloaded graph | Download published linked app; disconnect network and reopen | Original images/styles/modules/dataset content work without platform/capability URLs; graph bounded, missing dependencies explicit |
| Comments | Select/rightclick actual authored node in local file | Comment/Select original chooser; guest threads read-only; sign-in only for write; pins/geometry and role revocation remain correct |
| Theme | Open controls/composer; toggle Light/Dark | Open surfaces update reactively; author theme and platform controls remain readable |
| Saved view | Change navigation and private draft, post opted-in saved view, change return state then open/close | Exact allowlisted state only shared; private draft excluded; close restores live private return screen/draft; no platform/source reload |

## Exact reusable commands and prerequisites

- Private preview owner fixture: `node --import tsx scripts/fixtures/local-preview.mjs` (actual Chromium; builds only required runtime/parser). Run after final dataset/portable integration; do not repeat a whole-app build just for this fixture.
- Publication helper: `node services/app/skills/artifactbin/scripts/publication-bundle.mjs ROOT ENTRY SERVER REQUEST [MANIFEST.json]`; then same script `--send REQUEST`. Confirm final helper usage against candidate before sending. API POST/PUT accepts `publicationBundle:{entryPath,files:[{path,contentType,base64}],mappings?}`; bundle requires Idempotency-Key. Preserve request bytes/key on retry. PUT retains expectedVersion/expectedState.
- Prior comment browser harness is private and exact-deployment guarded. Reuse its actual selector/selection/role/theme assertions on the new owned fixture after the local shell contract stabilizes; do not run it against an old production receipt and relabel the result.
- Connection worker pending fixes, portable comment geometry, sign-in-window continuity, mismatch UI, current-state Save semantics, and downloaded dependency packer are prerequisites for full acceptance. Rows without a real receipt remain NOT RUN.
- Shared slow gates belong to the integrator once at the end of the brief, never per edit. Coordinate one combined build and process/port inventory before browser execution. This smoke itself does not launch an app, publish, sign in, or deploy.
