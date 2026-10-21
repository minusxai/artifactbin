# Historical view: resolved planning gate

Date: 2026-10-19. Candidate implementation, not a claim that the existing product runtime has been migrated.

## Decision

Phase 1 uses a **static saved view**, never arbitrary executable historical app code. This replaces the previous assumption that `allow-scripts` plus a restrictive CSP could prevent all network effects. The negative-control test demonstrates self-navigation reaches the HTTP server in Chromium, Firefox and WebKit despite `default-src 'none'`, `connect-src 'none'` and `form-action 'none'`.

The view record binds an immutable source revision, fixed JSON snapshot, and optionally captured rendered HTML. At snapshot creation, capture the app's rendered DOM and JSON together against that revision. Treat the captured DOM as untrusted input. Prefer that captured DOM for useful dynamically rendered content. If unavailable, show a **source-only static preview** with that limitation clearly labeled; show fixed JSON separately using text rendering. Never run the app merely to reconstruct a missing view, and never substitute current source for missing historical source. If the exact historical source is unavailable, explicitly fail with an unavailable-context state and offer an authenticated fetch when online.

The assembler deliberately rebuilds a semantic subset; this is not a pixel-exact or interactive replay. Headings, prose, code, lists, tables, Unicode and stable annotation IDs survive. Scripts, CSS, media, frames, SVG/MathML, canvases and templates are dropped; images become alt text; links/forms/controls/custom elements become inert text containers. Thus canvas charts and CSS-dependent layout are not recreated. Capture a separate inert screenshot later if visual fidelity is necessary; it is not required for this gate. Source bytes and JSON remain retained independently and are not destructively rewritten by preview projection.

The frame adapter owns `sandbox=""` (no allowances), sets the trusted CSP before generated content, and accepts no author CSP/URL/style/event attributes. A detached template parses source without connecting it to the live tree, avoiding custom-element upgrade and resource loads. Output DOM is created from a fixed HTML element allowlist. The frame has no scripts and cannot read its parent.

## Bridge and own-view contract

Entering history increments the bridge epoch and refuses all state, presence, comment and edit publication while history is open. Leaving increments it again so already queued async callbacks cannot publish after resume. The own JSON state is preserved by value and returned unchanged. Missing source or assembly failure is atomic: no history transition or epoch change occurs. Existing top-level application code may continue to execute; the guarantee covers platform publication and historical content, not freezing an arbitrary application's independent networking.

The candidate session is the pure typed policy behind a future transport adapter, not a replacement for protocol authentication/shape validation at that adapter. Its source map is supplied by the immutable, revision-verified source repository. Transport sender/origin/size validation is separate from this replay policy.

## Evidence

Interfaces were written before a failing behavioral test (missing candidate implementation), then implementation. Five pure behavioral tests pass:

1. Exact historical source required; no latest-source substitution; missing-source failure leaves session live.
2. All four publication kinds suppressed; stale epoch rejected after resume; own state retained.
3. Assembly failure leaves state/mode/epoch unchanged.
4. Captured rendered DOM uses the same assembler and still requires historical source.
5. Returned state copies cannot mutate internal own state.

The adversarial assembled browser fixture passes in **Chromium, Firefox and WebKit**. Each asserts: exact historical heading and annotation identity, retained Unicode, no custom-element upgrade, inert hyperlink and form text after actual clicks, zero surviving active tags/attributes, zero resource requests, opaque frame parent-DOM denial, publication suspension, stale-work rejection, resumed publication, and own state=7. Input attempts include fetch POST, beacon, WebSocket, self-navigation, popup, parent-DOM write, form actions, link ping, meta refresh, CSS imports/backgrounds, images/events, frames, objects, media, SVG, MathML, custom elements and nested templates. The server counts requests, including redirects/WebSocket upgrades; the fixture produces zero. These are adversarial regression cases plus a restrictive construction policy, not a claim of exhaustive proof over every future browser bug.

The negative control independently verifies active replay's self-navigation reaches the server once in each engine. This provides evidence for the safer policy instead of leaving the old active-replay risk open.

A first harness run followed the browser's favicon request through the generic redirect handler; this was a harness error, fixed by serving favicon with 204. The final three-engine run passes without filtering real source requests. The first negative-control assertion observed a request before its server response; waiting for the response fixed that race.

## Reproduce

```sh
node --import tsx --test experiments/readable-html/replay/model.test.ts
node experiments/readable-html/replay/browser.mjs
node experiments/readable-html/replay/active-negative-control.mjs
npx tsc --noEmit --strict --target ES2022 --module NodeNext --moduleResolution NodeNext --allowImportingTsExtensions --lib ES2022,DOM,DOM.Iterable --types node experiments/readable-html/replay/contracts.ts experiments/readable-html/replay/session.ts experiments/readable-html/replay/assembler.ts experiments/readable-html/replay/model.test.ts
```

All commands passed. Browser files bundle the actual candidate assembler/session with esbuild; they are not separate hand-written approximations of those modules. No package scripts or product source were changed. No generated output or credentials are included.

## Gate conclusion

The planning decision and its candidate integration are validated: choose non-executing semantic historical views with fixed JSON, captured rendered DOM where available, explicit source-only/unavailable states, epoch-gated platform publication, and unchanged own-view return. There is no remaining browser-platform research blocker for that selected contract. Phase 1 must wire the candidate policy into production capture, frame and transport adapters and retain these tests as acceptance criteria. The current product's active replay remains unchanged until that implementation; it must not inherit the stronger guarantee.
