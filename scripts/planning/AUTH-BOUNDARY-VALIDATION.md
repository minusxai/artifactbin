# Auth boundary validation — 7 September 2026

Current integration: main `323fa5d` merged at `6205327` on
`work/security-stage-one`. Delivery stays in draft PR #46. No production
deployment or session migration was performed. The sandbox work below passed
final combined-head regression and is being delivered through the same PR.

## Stage 1 verdict: sandbox direction proved locally; rollout gates remain open

The real human-session split and browser topology work in the measured flows.
This is not a sign-off for the entire architecture. The combined-head matrix
on the 546325f base passed: validate, 6,127 tests (one optional S3 skip), build,
51/51 browser gates in 142 seconds without retry, and the complete Firefox
and WebKit controls/consent flows. Main subsequently advanced to 323fa5d
(libraries and comment selection). The user approved a visible sandbox rather
than restoring parent-DOM author scripts; that direction is implemented and
the final integrated checks pass: validate, production build, 6,205 tests
(one optional S3 skip), all 52 browser gates in 143 seconds, and complete
Firefox and WebKit controls/consent/Sandbox flows.
Boundary-preserving rollback, staging and real-device evidence remain open.
Do not advance to Stage 2 on the old prototype results.

Hosted checks on `958708a` passed CodeQL and all deterministic CI jobs. Three
account-mode agent smoke jobs exposed a stale eval assumption: an MCP-scoped
OAuth token was used for REST setup and scoring, now correctly rejected with
401. Red→green credential/access-plan tests prove separate account API token
selection for driver/API work while MCP agents receive only the OAuth token.
The harness mints that separate token through the real human-session endpoint;
product audience checks are unchanged. A further real-flow check caught the
missing browser-context header on the human token mint. Reproduce without a
paid model: `node --import tsx scripts/planning/eval-account-audience.mjs`.
It passed real OTP/OAuth, MCP-token REST refusal, API-token publishing and
same-human-account ownership. Hosted agent reruns remain required.

### New main compatibility — generic Sandbox, not a Three.js component

Main `323fa5d` includes libraries (`e4df36d`, PR #55) and comment selection
(PR #53). Its original `gate-libraries.mjs` required an author Helmet script to
use `document.getElementById('scene')`, create a Three.js renderer on that
visible canvas, and export its rendered pixels. This feature branch's tested
contract deliberately runs that script in a hidden opaque iframe without
visible-DOM access or arbitrary network. Merely merging imports or relaxing
the library URL list cannot satisfy both contracts.

`<Sandbox title="Model" height={320} html="…" script="…" />` owns a visible
`sandbox="allow-scripts"` iframe. Its HTML/code are static strings (not JSX
children), each capped at 262144 characters. It has its own DOM/canvas and the
existing bounded data bridge; it cannot access parent DOM, account/edit verbs
or arbitrary network. Only platform-pinned library URLs and the anonymous
document-scoped asset resolver are admitted, plus blob/data buffers/textures.
The hidden Helmet script remains data-only. Height reserves 100–4096 pixels;
width follows the container. Internal IDs belong to the child, not parent node IDs.

Measured on the integrated implementation:
- Red tests preceded implementation of the realm, actual renderer integration
  and authoring validation; replacement/unmount revokes the old realm/port.
- The migrated library gate loads a textured GLB, verifies WebGL pixels and
  real PNG export, lazy/cached imports, missing refs and isolation. It passed.
- Complete controls gates in Chromium, Firefox and WebKit pass with a visible
  sandbox: pinned library, canvas, mouse/keyboard/touch input, mobile resize,
  local SQL updates, parent DOM/storage/API refusal, forged-edit refusal and
  reload reset. These are browser-engine tests, not physical-device certification.
- BrowserOS neo independently displayed a live Three.js cube on the two-host
  fixture; the parent Increment control changed the shared signal. The parent
  had no canvas node, and the visible child retained only allow-scripts.
- Full regression caught documentation size/listing caps, generated class
  freshness, the component gallery and false-positive fixture names. These
  were fixed without relaxing guard thresholds; all 122 focused guard tests pass.
- The first full browser run found one obsolete gallery assertion forbidding
  every nested frame. It now requires exactly the declared Sandbox children,
  each opaque with only allow-scripts; unexpected frames remain forbidden.
  The isolated rerun and subsequent complete 52-gate run both passed.

Migration is explicit: DOM-based Helmet scripts and their target HTML move
into Sandbox. There is no automatic or insecure same-realm fallback. Existing
library artifacts need that source migration. No reusable consent grants,
hard GPU/CPU quota or export readiness protocol are added by this primitive.

### New integrated evidence

- The first real mutation-consent slice works end-to-end in Chromium, Firefox and WebKit:
  non-owner artifact button → trusted review link → unframeable top-level
  approval page → single dataset commit → return to updated document. It uses
  existing app-owned hashed/expiring codes and a verified session identity.
  Six real-route checks cover expiry, read-only identity, wrong session/origin,
  changed document, revoked dataset access and concurrent/replayed approval.
  The original write-before-approval tests were red before implementation.
  This approves ONE exact operation, not reusable manifest grants; failures
  and uncertain outcomes never retry automatically. Resolved defaults are
  shown in the review. Owner-document and explicit bearer writes retain their
  existing authorization; local-state operations do not need approval.
- Browser-only consent failures were fixed without weakening origin checks:
  `no-referrer` made the native POST carry `Origin: null`; `same-origin`
  preserves the trusted Origin without cross-origin referrer disclosure.
  Chromium also enforced `form-action` on the return redirect. Only the
  server-owned document return is now admitted. Native OAuth approval had
  omitted its registered callback origin; a red regression caught it, and
  the Chromium gate now completes actual native approval + PKCE token mint.
- A private-document ACL revocation between SQL and commit initially returned
  200. The commit now locks document/target in stable order, rechecks roles in
  a fresh statement inside the transaction, and sharing changes take the same
  row lock. Real PostgreSQL tests prove both document and dataset revocations
  block the pending mutation and leave data unchanged. The full run exposed
  a fixture teardown race; its app pool now closes before Docker is stopped.
- The actual OAuth-issued MCP token initially returned 200 from the general
  artifact API despite the proxy's audience rejection: a legacy app resolver
  re-read the unchanged bearer header. The session boundary now removes
  audience-rejected known bearer tokens before downstream handlers. A full
  regression then caught stripping the operator's separate admin secret too;
  unknown/non-token credentials remain available to its verifier, without
  granting an app actor. Accepted tokens and OAuth client-auth schemes remain
  intact. The real browser-issued MCP token gets 401 outside its resource;
  all 18 focused proxy/OAuth/operator-revocation checks pass after this fix.

- Real Better Auth OTP issues distinct host-only `__Host-mx.session_token`
  and domain-scoped `__Secure-mx-read` cookies. Read handles store only hashes,
  join the live session on each request, and stop resolving after logout,
  expiry or revocation. Duplicate cookies fail closed.
- Real Better Auth OIDC with a disposable provider uses the trusted callback
  hostname, rejects main-host callbacks and forged/replayed state, and issues
  the same cookie split. This does not test a production provider registration.
- Real OTP → native trusted OAuth approval → main-host MCP PKCE exchange
  passes. Wrong origins/sessions, expired/revoked approvals and replay are
  rejected; two concurrent approvals yield exactly one success.
- A legacy-cookie cutover rehearsal preserves user identity on fresh login
  and refuses legacy cookies in the new topology. The old policy still accepts
  its old cookies: disabling the controls boundary is NOT a safe rollback.
- Main no longer accepts ambient account cookies. Only document reads resolve
  read authority. The proxy strips cookies before forwarding main requests,
  preventing legacy app handlers from decoding and widening that verdict.
  The regression was red before the fix. Main token adoption is also denied.
- Token-held browser sessions now have a per-browser nonce and separate hashed
  read handle. Actual claimed-token private reads work without a human session.
  Disconnect revokes copied full/read cookies from that browser, not another
  browser holding the same token. A red regression exposed the token reader's
  positive cache; browser resolution now invalidates it before checking liveness.
- A first-time invitee initially received 404 after successful OTP login: an
  unresolved email invitation needed the verified email before an app profile
  existed. The read identity now includes that server-only ACL claim. All three
  engines pass the first-login flow and assert the email is absent from HTML.
- Controls-enabled app servers reject requests lacking the proxy's attached or
  signed actor verdict. The direct-backend regression was red (302 instead of
  403), then green; a forged transport header is rejected and valid anonymous
  proxy requests still work. Legacy app-only mode is unchanged when disabled.
- Trusted APIs require an exact origin and custom header, not credentialed
  main-host CORS. Native SSE has a narrow same-origin Fetch Metadata exception.
  Native OAuth consent uses a one-time session-bound token. These are distinct
  mechanisms; there is no universal synchronizer-token implementation.
- Only `/controls/a/<id>` is frameable by main. Trusted login/workspace/token
  pages are top-level, and author routes/imported active assets are denied.
  Hono response replacement restored old CSP headers; using its header API
  fixed the actual OAuth framing regression, including immutable redirects.
- The new real two-host application gate passed Chromium, Firefox and WebKit:
  editing/reload, local SQL, comments, mobile controls, author attacks, OTP,
  social actions, private ACLs, logout and browser disconnect. The final
  ecfdcbb build includes the direct-backend guard and complete consent flow.
- The login helper itself had a false positive: a polling API treated its async
  predicate as truthy. BrowserOS independently measured the missing-header
  session request as 403, protected request as 200. The helper now awaits and
  checks the actual account response; its negative regression and all three
  engine flows pass after that correction.
- Actual PostgreSQL concurrency: a second transaction edits the document while
  a real dataset mutation is pending. The final commit locks/checks the document,
  waits, and returns 409 without changing the dataset. The test asserts that the
  app uses its PostgreSQL adapter, not the embedded adapter. Separate real
  PostgreSQL cases cover document-share and dataset-share revocation. These
  are local fixtures, not production deployment evidence.
- Last complete pre-consent suite: **6,117 tests**, one skip
  (1,289 API + 3,728 Node + 1,094 UI + 6 CLI); all 51 browser gates and
  Firefox/WebKit controls passed with disposable local object storage.
  The final ecfdcbb suite, including consent and MCP fallback protection,
  passed **6,127 tests** (1,295 API + 3,730 Node + 1,095 UI + 7 CLI), with
  one optional `TEST_S3_URL` integration skip. All 51 browser gates passed in
  142 seconds across six disposable servers without retry; complete Firefox
  and WebKit controls flows passed too. The 26 standalone policy checks also
  passed. An earlier API run's passing assertions did NOT count as green:
  PostgreSQL teardown emitted unhandled errors. Cleanup now runs through the
  harness-owned `afterClose` hook, preserving its database-ownership contract.
  Latest main `546325f` is merged and lockfile install/dry-run checks pass.
- The earlier 51-gate run failed the new PostgreSQL-source fixture because its
  runner disallowed its own loopback database. Only disposable runner-owned
  servers selecting that gate now enable private-network dataset access; the
  isolated gate passed. Production and externally supplied servers are unchanged.

### Reproduce the new auth checks

```sh
npx vitest run --config vitest.config.ts --project=node services/proxy/__tests__/read-session.test.ts services/proxy/__tests__/human-auth-boundary.test.ts services/proxy/__tests__/oidc-browser-boundary.test.ts services/proxy/__tests__/browser-boundary.test.ts services/proxy/__tests__/oauth-browser-boundary.test.ts
npm run validate
npm test
npm run build
node scripts/gate-trusted-controls.mjs --browser=chromium
node scripts/gate-trusted-controls.mjs --browser=firefox
node scripts/gate-trusted-controls.mjs --browser=webkit
```

Run suite/build/browser phases sequentially: the unit-test setup rebuilds the
runtime manifest. The browser gate uses `node:http` for its explicit Host
header; Node 22 global fetch did not preserve that header in a measured echo
probe. Do not count a gate that failed to reach the configured host as an auth
result.

## Earlier evidence (before the integrated human-auth split)

## Decisions supported by execution

- Full host-only HttpOnly session on the controls origin + separate read cookie works in Chromium, Firefox and WebKit. Main does not receive the full cookie.
- Main-origin requests to the controls host DO carry its full cookie. Exact server-side Origin/CSRF/authority checks reject them; CORS is not the write boundary.
- Trusted requests succeed once; replay is rejected. Server-side revocation invalidates private reads even while the browser retains its read cookie.
- The controls iframe cannot read parent DOM. The token page sends `frame-ancestors 'none'`; BrowserOS Chromium also verified actual framing refusal.
- The real application's controls flow is viable across all three engines with the local fixes below. This flow still uses the existing main-host authentication, not the proposed migration.

## Defects discovered and locally corrected

1. WebKit liveness: a `postMessage` method captured from the trusted child's initial about:blank Window becomes stale on navigation. Resolve through the captured WindowProxy per send; retain exact origin/window checks. Unit regression was red (`initial about:blank` vs `navigated controls`), then green; actual WebKit gate advanced past the failure.
2. WebKit modal focus: default keyboard navigation can skip buttons and exit the modal before the last-stop trap runs. Own each Tab step inside a true modal. Regression was red (`defaultPrevented=false`), then green; WebKit's 20-Tab assertion passed.
3. Private media caching: actual private PDF/image route responses were `private, max-age=300` (versioned PDF measured as year-long immutable caching). Serve nonpublic media `no-store`; public caching unchanged. Both regression cases were red, then green.
4. Gate reproducibility: browser disconnect navigates to the same URL. Wait for that navigation rather than fetching from WebKit's outgoing context.
5. Probe reproducibility: Firefox automation can hang inspecting a CSP-refused child DOM. Assert response framing policy automatically; actual Chromium refusal separately inspected in BrowserOS. This is not a claim of visual refusal testing in every browser.

## Reproduce

```sh
node --test scripts/planning/auth-boundary.test.mjs
node scripts/planning/auth-boundary-browser.mjs
npm run validate
npm test
npm run build
npm run test:gates
node scripts/gate-trusted-controls.mjs --browser=firefox
node scripts/gate-trusted-controls.mjs --browser=webkit
```

- Policy model: 26 tests passed. It is deliberately not imported by production.
- Three-engine prototype: passed cookie scope/HttpOnly, trusted writes, root/simple-write denial, replay, DOM isolation, framing header and revocation checks.
- Post-fix application suite: 1,236 API + 3,410 Node + 1,034 UI = 5,680 passed; one Node skip.
- Build and type validation passed.
- Baseline full gates: 50/50, viz-editor needed the runner's isolated retry after an internal-error response. Do not relabel that as a clean first-pass run.
- Full post-fix gates: 50/50 passed in 151 seconds, no retry. Final Firefox controls rerun passed; WebKit complete controls flow passed after the fixes.

## Risk register / claims NOT proven by these probes

| Risk | Status | Evidence / required work |
|---|---|---|
| Sibling-origin cookie mechanics | MEASURED | Three-engine HTTPS fixture; actual server observations show privileged cookie on rejected cross-origin request. |
| Auth migration, old cookies, agents, OAuth callbacks | OPEN | Fixture uses a test-only issuer, not Better Auth. Existing product gate covers OTP/agent behavior under the OLD authority topology. Need real two-host route/identity integration and migration rehearsal. |
| Mutation consent | MITIGATED in model; OPEN in product | Model checks user/session/document/definition/target/operation, ACL, replay. Production consent UI/storage and atomic execution binding are not implemented. |
| Private media browser cache | MITIGATED locally | Real route regressions pass with no-store. Cannot revoke files already downloaded or bytes previously cached under old headers; cutover needs cache-key rotation and honest revocation semantics. |
| Shared-main-origin execution | MEASURED controls isolation, residual risk | Actual author isolation gate passes. No per-document browser boundary; any future main-origin XSS could access other readable documents. No finite payload corpus proves absence of XSS. |
| Private imported assets | OPEN | `/assets/<hash>` is intentionally public; must not treat a private document as making its imported URL assets private. Keep confidential uploads behind artifact ACL routes. |
| Clipping / keyboard | MITIGATED in tested engines | Actual controls gate, including modal and nonmodal interaction. Real iOS keyboard, device zoom and assistive technology still require device checks. No clickjacking guarantee. |
| Integration | OPEN | `git merge-tree --write-tree --name-only HEAD origin/main` reproduces seven conflicts. No tested merged head exists yet. |
| Deployment | OPEN | No staging TLS/proxy/CDN/host allowlist or real auth-provider callback configuration was changed/tested. |

The result is evidence of feasibility plus reproducible fixes, not certification of an unimplemented auth migration. Do not use a green model or the old topology's green suite to claim that migration is fully validated.
