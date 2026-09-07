# Auth boundary validation — 7 September 2026

Base: `9138270`, `feat/isolated-author-scripts`, plus the local patch in this working tree.
No production deployment, session migration, or PR push was performed.

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
