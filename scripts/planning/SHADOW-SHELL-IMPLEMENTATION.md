# Same-origin app with trusted Shadow DOM

Approved proposal: https://artifactbin.dev/a/IJd3e4 (v3).
Base: origin/main 4aee49e. Integration branch: feat/same-origin-shadow-shell.
Old split-unified-shell work is paused and must not be merged.

## Decisions

- Browser address and first-party authentication remain on the main origin.
- One reusable trusted Shadow DOM host holds the topbar on every route and artifact actions/dialogs where applicable. Author markup remains top-level outside it.
- Author code stays in the existing opaque, protected sandbox frames. Shadow DOM does not replace that security boundary.
- Direct first-party routes and one client router; no whole-page controls iframe or geometry-mirroring protocol.
- APP__SSR_ENABLED=false by default. Optional dynamic SSR changes initial body rendering only; static logged-out landing remains possible. Auth, ACL, metadata and security headers remain server decisions.
- No production deployment in this implementation task. End deliverable: tested PR with empty body.

## Risk-ranked gates

| Priority / gate | Status | Evidence / required acceptance |
|---|---|---|
| Stored legacy markup cannot execute in first-party realm | MITIGATED at shared reader | 59 relevant tests green after f113e26; root removed guard and reproduced six failures, then restored it. Full client mount must use the same guard. |
| Same-origin cookie operations retain strict CSRF proof | OPEN, reproduced | Seed same-origin-browser.test.ts composed proxy: 6 proof-refusal cases red, valid cookie/bearer cases green. |
| ShadowRoot preserves context and contains portals | MITIGATED primitive; integration OPEN | 19 primitive/tooltip/sheet tests independently green at 3f71fa9. BrowserOS actual-component fixture: controls blue despite author red!important; tooltip/input absent from light DOM; action click increments; closed root. Author CSS :has probe remains 100px before/after dummy sensitive attribute change. Author script parent DOM = SecurityError; network blocked; server observed zero API calls. Full built styles, dialogs and keyboard still require integration review. |
| Parent bootstrap cannot be clobbered by author IDs or stale lifecycle | OPEN | Explicit root/data references; no lookup into authored subtree for trusted config. Route teardown tests required. |
| Top-level runtime retains editing/data/live capabilities | OPEN | Need reusable mount/dispose lifecycle over existing StoryRuntimeApp/store/edit protocol, not a second interpreter or author iframe. |
| Auth returns and private cache stay correct | OPEN | Actual login, expired session, logout, return intent, account/tokens; private no-store and uniform 404s. |
| Client routing truly avoids document reload | OPEN | Home/account/profile/artifact/back/forward with window identity and shell host identity checks. Save failure must prevent losing edits. |
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

## Baseline notes

Unchanged main full run: API 166 files / 1335 tests passed; Node 366/369 files passed with database startup/hook failures and login-provider timeout. Isolated retry is in progress; not classified as harmless. Integration shared shell and initial-page tests intentionally remain red until their implementation phases.
