# Script isolation and top-level artifacts

## Decisions

- Preserve existing artifact URLs and render the artifact at top level.
- Author JavaScript runs only in an opaque-origin sandboxed child, never in the renderer's realm.
- Preserve Helmet script syntax, replace DOM access with document-scoped signals/data/mutations.
- No author bridge to account actions, arbitrary URLs, source edits, HTML rendering, or auth credentials.
- Trusted account controls live separately; author CSS may hide them. User accepts clickjacking risk.
- Never relax the existing document sandbox until all author-code execution paths are isolated.
- Confirmed: author scripts lose visible DOM access. Migrate the roadmap using
  restricted reactive JSX, composable dialogs, and existing Mutation/run bindings.
- Local SQL writes target a declared inline table or reserved `_signals` (one
  typed row reflecting scalar Values); persistent writes retain `ref_<id>` ACLs.
  No mixed local/persistent mutation, general action language, or arbitrary JS expressions.

## Current checkpoint — implementation complete, PR/CI review next

### Trusted controls integration

- Opt-in `APP__CONTROLS_ORIGIN` keeps the document top-level and serves app
  controls in a cross-origin child. Default deployment behavior is unchanged.
- **No session migration or cookie handoff.** Existing host-only HttpOnly cookies
  stay on the main/API host. The trusted child calls that API with credentials
  and exact-origin CORS. `controls-cookie-probe.mjs` measured this over real HTTPS
  sibling hosts: authenticated JSON POST/preflight, no cookie on the controls
  host, parent DOM denied, wrong-origin write refused. Localhost versus
  i.localhost is not a valid same-site cookie test.
- Built-server acceptance now measures top-level save/reload, local SQL relay,
  light/dark switching, comments without markup/version edits, mobile hit-testing,
  isolated-author DOM/storage/network refusal and child-navigation revocation,
  real OTP login, persistent likes/follows, private dataset queries/requeries,
  private-document revocation, account sign-out and independent agent disconnect.
- Measured/fixed: fully clipped Chromium iframes suspend animation callbacks,
  so region reporting boots on a task; comment rails account for the fixed
  top bar; share links use the main origin; the top-level runtime answers
  addressed liveness checks instead of relying on the old parent-frame script.
- Current suites: **5,652 passed, one skipped** (1,228 API + 3,408 Node + 1,016 UI).
  Full browser sweep: **50/50 passed**, one isolated retry under contention.
  The expanded two-origin gate passed again after the final fixes. Typecheck
  and production build passed. Neo desktop/mobile inspection found and verified
  the transparent-menu fix; its regression test was observed red then green.
- Production requires provisioned HTTPS/DNS routing for the controls host and
  the same setting in proxy/app processes. Neither deployment nor DNS has been
  changed. PR creation follows full review and acceptance, with an empty body.

### Reactive markup and dialog milestone

- Restricted scalar expressions and structural conditional JSX now parse,
  validate, serialize, and render. Both branches retain real node IDs and
  reference checks; text edits/deletion preserve the hidden branch.
- Native Dialog root/trigger/content/close primitives bind scalar state.
  Content can use existing `run=` for validated submit-and-close, with pending
  deduplication, refusal feedback, Escape, and focus return.
- Migrated the roadmap fixture off its DOM script. Its original browser
  acceptance passes: views, DAG, sprint creation/conflicts, cell dropdowns,
  reload persistence, mobile layout. No gate removed or weakened.
- Browser validation found native submit events blocked by the old sandbox.
  The trusted renderer now permits forms, while form-action none forbids
  navigation; the author child still has no forms permission. The security
  gate continues to prove forged forms/account actions fail.
- Full suite: **5,641 passed, one skipped** (1,228 API + 3,401 Node + 1,012 UI).
  Focused built-server gates: roadmap-views, author-script-isolation,
  secure-arch **3/3 passed**. Subsequent full sweep passed **49/49**.
- Top-level owner/editor rendering is integrated in the next milestone above.
  Existing host-only account and agent cookies never become parent-domain cookies.

### SQL local-state milestone

- 19 execution cases initially produced 17 RED failures against the skeleton;
  implemented using the existing stateless SQL service, tested in-process and
  through its real HTTP transport. Added dry-run, declaration, query, store,
  API, and relay tests, each with observed RED before its implementation.
- `_signals` is update-only; inline tables support INSERT/UPDATE/DELETE and
  existing row-scoped editable controls. Types come from declarations. No
  dataset storage is used; local SQL computation still makes a server round trip.
- Browser state commits atomically, serializes local operations, rejects stale
  responses after state/source changes, and preserves local rows across query
  refreshes. Local rows reset on reload; unchanged declarations retain drafts
  across live source updates.
- Working-tree full suite: **5,599 passed, one skipped** (1,228 API + 3,365 Node
  + 1,006 UI), type validation and production build passed.
- Built-server gates **2/2 passed**: author-script-isolation and local-sql-state.
  New gate passed direct anonymous and signed-in relayed flows, inline inserts,
  row edits, refresh, reload reset, and unchanged artifact versions. It failed
  against the previous built server at local-mutation admission first.
- Existing scalar Values are URL-backed. Asked whether SQL updates should
  preserve that behavior; currently preserved for compatibility. This differs
  from inline tables' unconditional reload reset and must be resolved/documented.
- Conditional JSX, dialog composition, roadmap migration, and trusted-control
  topology remain required work. No PR or deployment yet.

- Working branch `feat/isolated-author-scripts`, based on latest fetched main `921d578`.
- Isolated execution, bounded signals/query/mutation bridge, and live script
  replacement/removal are implemented locally. No production changes.
- Focused built-server gates passed: author-script-isolation, dataflow,
  inplace-edit, script-slice. Full browser run: **47/48 passing**.
- Current API, Node, and UI suite runs: **5,552 passing, one skipped** across
  585 files (1,224 API + 3,323 Node + 1,005 UI). Type validation and diff checks
  pass. The Node rerun includes fixes for the gate manifest classification and
  documentation contracts/file-size limits. No gate was quarantined or removed.
- `roadmap-views` is a real compatibility failure: its authored script directly
  switches section visibility and controls the sprint dialog. Signals alone do
  not currently provide equivalent declarative visibility/dialog actions. Do not
  remove or weaken this gate to conceal that loss.
- `web-assets` measured CLS 0.0286 under parallel load but passed its isolated
  retry; it is not the remaining failing gate.
- Top-level owner/editor rendering and trusted-controls iframes are **not yet
  implemented**. The existing top-level sandbox has not been relaxed.
- User approved the complete expanded proposal and explicitly expects a fully
  implemented, tested PR. Use the originally discussed trusted-controls origin;
  a local two-port cookie experiment does not validate production login migration.

## Risk-driven milestones

1. Prove child isolation, authenticated sibling frames, and a narrow data bridge in real browsers.
2. Integrate isolated execution into every rendering path; tests must fail against old execution first.
3. Local SQL state: reuse stateless SQL service, validate declaration-owned types,
   atomically commit snapshots, isolate each viewer, and reject stale responses.
4. Restricted reactive JSX + modal state bindings, preserving node IDs and
   comment/edit targeting; migrate roadmap without weakening its acceptance gate.
5. Top-level rendering plus trusted account controls; audit private reads, editing, login, and permissions.
6. Full suites, built-server gates, desktop/mobile browser acceptance, PR with empty body, CI.

## Risk register

| Risk | Status | Evidence / remaining check |
| --- | --- | --- |
| Opaque author child cannot access parent DOM or storage | MEASURED (prototype) | Neo local page 53: both SecurityError |
| Script child network remains blocked | MEASURED (prototype) | Child CSP default-src none; fetch rejected |
| MessageChannel works across opaque boundary | MEASURED (prototype) | Received signal=working |
| Non-opaque trusted sibling can authenticate | MEASURED (local prototype only) | Separate 127.0.0.1 port, cookie round trip true |
| HTTPS subdomain cookie/login behavior | MEASURED | Real HTTPS siblings, host-only cookies, OTP login, JSON CORS, sign-out; production hostname provisioning remains a deployment prerequisite |
| Forged account/edit/query messages | PASS (current topology) | Real-browser gate checks forged like/follow/edit denial; unit tests reject undeclared operations. Must repeat after topology changes |
| Raw/static/export paths executing author script | IMPLEMENTED / TESTED | Builder always parks source inert, including no-runtime paths; runtime alone launches the child |
| Script lifecycle after live update/reload | PASS | Browser replacement/removal/reload plus unit unchanged-source/disposal tests |
| Private document and dataset permission preservation | PASS | Private dataset query/requery in top-level document; nonmember/private revocation 404; existing mutation-permissions gate green |
| Existing DOM-based script compatibility | CONFIRMED MIGRATION | User approved minimal reactive primitives and SQL state; roadmap gate must pass without its DOM script |
| Local SQL state execution and types | PASS | Same real SqlService locally/HTTP; API and browser gate prove no persistence and declaration-owned types |
| Local snapshots and asynchronous races | PASS (store tests) | Queued writes, double-click dedupe, stale signal/source responses rejected; browser gate covers transport and refresh |
| Conditional identity and SSR/hydration | PASS | Both branches retain IDs; parser/renderer/source-edit tests and script-free roadmap browser gate |
| Working-tree regression suites | PASS | 5,652 passed, one skipped; typecheck, build, 50 browser gates. This is not an untouched-main baseline |
| Child navigation after CSP changes | PASS | Navigating the opaque author child to the controls host cannot gain authority; second load revokes/removes its realm |
| Resource exhaustion | BOUNDED BRIDGE, NOT CPU QUOTAS | Rate/payload/pending limits and teardown tested. Browser script execution has no hard CPU quota; origin isolation is not a resource scheduler |

## Prototype notes

6 September: local two-origin Node HTTP prototype driven through BrowserOS Neo.
Parent CSP sandbox allow-scripts allow-same-origin; author srcdoc sandbox allow-scripts
and child default-src none / script-src unsafe-inline. Trusted sibling frame uses its real origin.
Observed: parent DOM denied, localStorage denied, fetch blocked, MessageChannel delivered,
authenticated sibling cookie round trip successful. No production writes or auth changes.
An initial localhost/127.0.0.1 mix failed the cookie test (cross-site); corrected to same-site
distinct ports. This does not replace HTTPS subdomain testing.
