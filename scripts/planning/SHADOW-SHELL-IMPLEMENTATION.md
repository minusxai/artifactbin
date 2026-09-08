# Same-origin app with trusted Shadow DOM

Approved proposal: https://artifactbin.dev/a/IJd3e4 (v3).
Base: origin/main 4aee49e. Integration branch: feat/same-origin-shadow-shell.
Old split-unified-shell work is paused and must not be merged.

## Decisions

- Browser address and first-party authentication remain on the main origin.
- One reusable trusted Shadow DOM host holds the topbar on every route and artifact actions/dialogs where applicable. Author markup remains top-level outside it.
- Author code stays in the existing opaque, protected sandbox frames. Shadow DOM does not replace that security boundary.
- With the strict first-party CSP, the protective outer author wrapper must be a fixed HTTP document with its own sandbox/CSP; the inner author realm remains opaque sandboxed `srcdoc`. Do not enable inline author scripts in the parent to make startup work.
- Direct first-party routes and one client router; no whole-page controls iframe or geometry-mirroring protocol.
- APP__SSR_ENABLED=false by default. Optional dynamic SSR changes initial body rendering only; static logged-out landing remains possible. Auth, ACL, metadata and security headers remain server decisions.
- No production deployment in this implementation task. End deliverable: tested PR with empty body.

## Risk-ranked gates

| Priority / gate | Status | Evidence / required acceptance |
|---|---|---|
| Stored legacy markup cannot execute in first-party realm | MITIGATED at shared reader | 59 relevant tests green after f113e26; root removed guard and reproduced six failures, then restored it. Full client mount must use the same guard. |
| Same-origin cookie operations retain strict CSRF proof | MITIGATED prerequisite | 204e651 exact Origin/CSRF and unconditional one-use OAuth consent. Independent mixed selection 537 green; root disabled boundary and observed eight failures, restored implementation. Full cutover still pending. |
| ShadowRoot preserves context and contains portals | MITIGATED primitive; integration OPEN | 19 primitive/tooltip/sheet tests independently green at 3f71fa9. BrowserOS actual-component fixture: controls blue despite author red!important; tooltip/input absent from light DOM; action click increments; closed root. Author CSS :has probe remains 100px before/after dummy sensitive attribute change. Author script parent DOM = SecurityError; network blocked; server observed zero API calls. Full built styles, dialogs and keyboard still require integration review. |
| Parent bootstrap cannot be clobbered by author IDs or stale lifecycle | OPEN | Explicit root/data references; no lookup into authored subtree for trusted config. Route teardown tests required. |
| Top-level runtime retains editing/data/live capabilities | Lifecycle MITIGATED; integration OPEN | 51d25d1 reusable mount/dispose over existing runtime. Runtime selections green; independent disabled-mount control red. Relay listeners and pending timers now disposed. Integration seed still red until ArtifactSurface conversion. |
| Auth returns and private cache stay correct | OPEN | Actual login, expired session, logout, return intent, account/tokens; private no-store and uniform 404s. |
| Client routing truly avoids document reload | PARTIALLY MEASURED | Production bundle, BrowserOS: privacy→terms→account→login retains window marker and same topbar backend IDs, zero framing iframes. Found scroll reset/sticky header bugs; client agent fixing with regression coverage. Artifact transitions/save blocking remain open. |
| Both SSR settings produce correct functional pages | OPEN | Static landing; themed pending states; CSR mount vs SSR hydration; metadata/ACL unaffected; captures still render content. |
| Browser/platform regressions | OPEN | Full node/API/UI suites and browser gates, plus cross-engine boundary/focus lifecycle checks and mobile browser review. |

## Milestones (not completion claims)

1. Security and composition prerequisites: reproduce red, implement narrow seams, independently rerun tests and browser probes. No same-origin rollout before these pass.
2. Integrate one mounted app/runtime lifecycle, trusted host and direct APIs; preserve all author data/edit/live behaviors. Boot one local stack and prove a full artifact edit + reload + navigation roundtrip.
3. Complete direct app pages, static landing, optional SSR and cohesive skeletons. Exercise login/return/logout and all route transitions on desktop/mobile.
4. Delete superseded split-shell transport, update operational/docs/skills guidance, run full regression + production-like gates, review final diff and open PR. CI must pass before declaring ready.

## Work ownership

- Root: contracts, red verification, integration architecture, local browser verification and independent review.
- shadow_read_safety: read-time boundary only; separate worktree.
- migration_review: primitive reviewed; now persistent host, PageChrome and SPA navigation in separate worktree. shared-trusted-shell seed independently red (zero roots).
- restore_interactions (new task): same-origin server browser proof only; separate worktree. Older work is not resumed.

All stage results must record observed commands/output. A prototype pass is not a production signoff.

## Integration review, September 8

- Client commit 45796c7 independently rerun after integration: validate passed; full UI 1,251 passed, one intentionally pending top-level artifact seed failed. Session bootstrap, loading/retry, shared resolved HomeView and scroll/sticky fixes are present; real-browser geometry review still required.
- Review caught a login race: busy was cleared before session verification completed. Followup 7a5c3dd adds a synchronous submit guard through the complete flow and a deferred-response regression; integrated as 148d4ba.
- Artifact commit 3eef918 integrated for cross-module testing, **not accepted as fully reviewed**. Large test deletions need retained-behavior restoration/mapping. Review also found a no-comment-access sidebar condition left on the retired controls-only mode and incomplete route failure UI. Agent is correcting these before acceptance.
- Strict CSP reproduction: `scripts/planning/strict-parent-wrapper.mts`, port 5804. In BrowserOS, `/srcdoc` stays pending under parent `script-src 'self'`; `/http` executes author code while parent DOM access throws SecurityError and fetch is blocked. `/http-nav` rejects ancestor navigation, removes the frame on attempted self navigation, retains the parent URL, and records zero fixture requests. This is a prototype (test-only srcdoc setter interception), not the implementation acceptance test. The fixed production wrapper must use a one-time port to receive the trusted-prepared inner document and be retested under the real app CSP.
- Final auth retirement remains open: host-only human session cookie and per-browser disconnect revocation have explicit failing seeds (66407d3, 5f9a934). Old controls-origin config must not silently retain split behavior.
- Built-app browser review after client integration: privacy→terms preserves the window marker and identical topbar backend node IDs, zero iframes, resets scroll to zero. At scrollY 1800, menu button remains at viewport y=3.5..39.5. Account→local email OTP→Account retains the window marker and main origin with no document reload. Test account and mail were local only.
- Login regression independently verified with guard temporarily removed: duplicate sign-ins (2 versus expected 1), then restored; all six auth/navigation tests pass. No negative-control production edits retained.
- Opaque `/raw` compatibility probe: `frame-ancestors 'self'` on the wrapper blocks an opaque parent; removing that directive from the fixed public wrapper makes it run while parent DOM still throws SecurityError and fetch remains blocked. Retain the response-header sandbox (including direct visits). This exception applies only to the powerless wrapper, not first-party UI framing policy; final server implementation still needs the same check.
- Integrated server 79498ae independently validated: API 168 files / 1320 pass; UI 161 files / 1205 pass; Node 3880 pass, one existing skip, exactly three pending auth-cutover seeds red; validate/build pass. CLI 7/7 pass. No unrelated Node failure remains in this run.
- Updated strict-parent probe now runs the actual fixed HTTP wrapper endpoint and current bootstrap protocol: regular and opaque parents both report DOM SecurityError/network blocked; navigation attempt removes the author frame; server observed zero fixture requests. Actual built app at local main/asset host also executes Helmet signals and renders an isolated canvas with no canvas in the parent DOM.
- Browser gate run (three gates): author-script-isolation PASS, including live script replacement/removal and forged account/edit messages. Editable-table and local-sql-state FAIL because direct payload `chrome:false` also disables mutation controls. Agent is restoring live runtime mode with regression tests. Do not count these flows as validated yet.
- Visual check found missing document presentation CSS and viewport inset: heading/paragraph at y=0..42 behind the fixed bar. Direct presentation must reuse the raw renderer's typography/font/table/column contracts, scoped and disposed with the authored surface. Also missing runtime sandbox/asset configuration is being audited against the existing builder. These are implementation gaps, not accepted UX limitations.

## Baseline notes

### Integrated review followups (not final acceptance)

- Client retirement integrated as 912274f: shared document typography/fonts/insets, runtime `chrome:true` for interactive documents, sandbox/asset configuration, and immediate-adopt author startup fix. Superseded public/region/control entrypoints removed. Root UI 155 files / 1174 passed; Node 372 files / 3869 passed plus one skip. API found a test-harness naming violation, corrected in 2cf76ec; full repeat pending.
- Root reproduced editor-anchor spoofing with the implementation guard removed: five failures, including selecting AAAA incorrectly resolving BBBB. Restored b5f2ab4: all 17 interpreter tests and validation pass.
- Root seeded and reproduced missing live glyphs in both API frame and mounted runtime. 2a5bea4 carries server-resolved glyphs through live adoption; full integrated rerun pending.
- First full 54-gate attempt stopped early: actual `/api/start` returned 500 because the app encoder omitted browser nonces when the retired controls setting was empty. 18096b4 fixes the real producer, with proxy→app start/adopt/disconnect regression coverage. Do not substitute utility-generated cookie tests for this integration.
- The same attempt exposed a browser startup crash (`global is not defined`): Surface presentation imported a font validator through the server resolver/database graph. fda634a extracts the pure font contract. Rebuilt app no longer includes server-module externalization warnings. Real browser reboot and complete gate rerun are required before acceptance.

Unchanged main full run: API 166 files / 1335 tests passed; Node 366/369 files passed with database startup/hook failures and login-provider timeout. Isolated retry passed all 70 tests. Full baseline UI passed 151 files / 1208 tests. Integrated prerequisite production build and typecheck pass at 6a960a7; remaining initial-page/top-level integration seeds intentionally red. Root caught two late runtime test typing errors and merged 6a960a7; prior agent's typecheck claim preceded those test edits.

## Current implementation ownership

- page-server: direct server responses, SSR flag, validated startup projection and mandatory proxy verdict.
- page-client: bootstrap consumption, no-flash Home/account loading, auth refresh, route scrolling and sticky trusted host.
- artifact_completion: top-level ArtifactSurface, safe runtime payload, trusted artifact controls and edit/data/live preservation. Replaces an agent whose response context was exhausted; that was not a repository blocker.
- Root: independent reviews, real production-build browser checks, final cutover/deletion planning and final regression/PR.
