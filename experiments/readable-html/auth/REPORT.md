# HTTPS authentication, routing and presentation ownership proof

This is a runnable architecture-validation implementation, isolated from product entrypoints. It uses actual HTTPS origins and browser-enforced cross-site boundaries. No external infrastructure, real accounts, production credentials or private deployment names are used. The login screen intentionally authenticates a synthetic account; it tests the credential handoff after authentication, not an identity provider.

## Selected design

**Use opener-independent server pairing as the robust default for local files.** The trusted frame generates a verifier and registers a pending document/channel/challenge-bound request. Only its public connection URL/request ID reaches the parent. A genuine click on that ordinary local-page anchor opens the service as a first-party tab, with `noopener` and COOP intentionally severing the opener. The service displays the requested document and asks the user to sign in and approve. The server checks the authenticated account and same-origin approval request, then marks the pending request approved. The trusted frame polls with its verifier and receives a one-use document-scoped session; the parent never relays a grant, verifier or credential. A public ID alone cannot redeem or approve. Pending requests expire after 60 seconds; revocation invalidates grants; successful redemption consumes the request. Direct-file pairing passes **Chromium, Firefox and WebKit**, including genuine parent-link activation and service-page approval.

The direct frame-popup handoff below is an optional faster path with a compatible opener. Pairing removes the opener/iframe-activation dependency when that path fails. Both share the same grant/session authorization policy.

1. A platform-origin credential frame generates a random verifier and channel in its own closure. The SHA-256 challenge is public. Neither verifier nor account/session token enters the parent, DOM export or URL.
2. A genuine frame click opens a platform-origin popup. Its URL contains document ID, channel and public challenge only. Sign-in establishes an HttpOnly, Secure, host-only `__Host-` account cookie, SameSite=Strict, in the first-party popup.
3. The authenticated popup requests a 60-second, one-use document/channel/challenge-bound grant. It sends the grant directly to its opener with an exact platform target origin. The frame requires exact popup Window identity, service origin and channel, then redeems with its private verifier. Failed mismatched attempts do not consume a legitimate grant.
4. The server returns a five-minute document-scoped capability held only in frame memory. Account cookies are not used during cross-site redemption. Expiry, revocation and replay are enforced by a pure policy; navigating the frame destroys the handshake. Failure/timeout is explicit; timeout also invalidates the expected popup. A denied popup or severed opener never reports success. Retry creates a new login attempt.
5. Web Storage and Storage Access API are not prerequisites: the test throws on cookie/localStorage/sessionStorage access and rejects requestStorageAccess inside the frame. Account-cookie absence on every frame redemption request is asserted at the server.
6. Hosted private execution uses a **public empty per-document runner**, not a public private-source endpoint and not an iframe credential in a URL. An authenticated platform shell retrieves source using its first-party account context. The runner accepts one source delivery only from its exact parent at the configured platform origin, bound to its random channel and protocol version. The app executes in the document origin and cannot read shell DOM. App-origin source/raw/history routes remain denied.
7. The thin shell has an external script and an iframe, plus an HTML comment, `rel=alternate type=text/plain` link and HTTP Link header pointing to the permission-checked canonical source endpoint. Source exposes an ETag revision. A raw GET of the shell is intentionally a shell; an agent follows explicit source discovery. No shell scraping is required.
8. **UI ownership is separate from authority.** Any exact parent, including another vendor or an opaque local parent, may offer topbar/modals ownership through a versioned channel. Pure policy latches a valid offer once, ignores wrong source/version/channel/types and late/duplicate offers, and defaults local at the timeout. Browser tests exercise an unrelated embed host claiming UI ownership. A UI offer never authenticates anything and is not accepted by the authorization module. Private-source delivery and credential handoff retain their service-specific origin checks.

The supported connected contexts are HTTPS embeds, hosted HTTPS shells and trustworthy loopback CLI previews. Arbitrary insecure HTTP ancestors make an HTTPS iframe an insecure context, so WebCrypto subtle is unavailable. This is an explicit context requirement, not a reason to put credentials in the app. Offline local operation does not depend on this connected flow.

## Reproduce

```sh
npx tsc -p experiments/readable-html/auth/tsconfig.json
node --test experiments/readable-html/auth/policy.test.mjs experiments/readable-html/auth/pairing.test.mjs
node experiments/readable-html/auth/browser.mjs
```

The public policy implementation is checked against `contracts.ts` with strict `checkJs`; it is not an unused declaration-only contract. Contracts and behavioral tests were written first; the initial test run failed because implementation was absent. Policy is now covered by eight behavioral tests (multiple table-driven cases per test). The browser harness generates a temporary certificate and starts HTTPS, a restricted CONNECT proxy and a loopback preview server, then closes connections and deletes temporary material.

## Observed results

| Behavior | Chromium | Firefox | WebKit |
| --- | --- | --- | --- |
| HTTPS cross-site frame → genuine popup → scoped session | Pass | Pass | Pass |
| Blocked storage / no account cookie on redemption | Pass | Pass | Pass |
| Wrong parent grant rejected; no secret parent/URL exposure | Pass | Pass | Pass |
| Private source/raw/history/shell denied without capability | Pass | Pass | Pass |
| Two document-origin storage and account-cookie isolation | Pass | Pass | Pass |
| Authenticated private hosted app, source discovery and ETag | Pass | Pass | Pass |
| Frame navigation invalidates pending popup | Pass | Pass | Pass |
| Popup denial and bounded no-response timeout | Pass | Pass | Pass |
| Unrelated parent claims presentation ownership only | Pass | Pass | Pass |
| Direct local file → genuine parent anchor → COOP/noopener approval → frame pairing | Pass | Pass | Pass |
| Optional direct local file iframe-popup login | Pass | Not established by driver | Pass |
| Local CLI loopback preview genuine popup login | Not needed in this matrix | Pass | Not needed in this matrix |
| Real COOP opener severing | Pass | Driver issue; timeout behavior injected | Timeout behavior injected |

Pure tests also cover exact expiry boundaries, one-use replay, wrong verifier/channel/document, grant/session revocation, malformed request bounds, unknown host routing, wrong document host, opaque parent UI offers, malformed UI offers, timeout and duplicate ownership offers.

## Compatibility decision and evidence limits

Firefox's Playwright file iframe renders and exchanges boot messages, but genuine mouse/keyboard activation did not reach the child in this harness. Attempts included frame locators, page-coordinate input, page-level acknowledgements, fresh contexts, repeated keyboard focus, headless and headed Firefox. A Fission experiment did not resolve it and was reverted. We do **not** label the optional direct iframe-popup Firefox path as passed or assert this proves a Firefox product defect. Instead, the implemented server-pairing path removes that dependency: the user clicks a normal parent anchor, authenticates on the first-party service, and the trusted frame independently redeems. That direct-file flow passes all three engines, without parent credential relay. The CLI loopback preview also passes in Firefox; it is an additional option, not a requirement for local-file connection.

COOP can intentionally sever the opener. Only the optional direct-popup path requires preserving the opener until handoff. The default pairing path deliberately uses both noopener and COOP and passes all three engines; identity-provider redirects cannot break an opener dependency because there is none. The actual severed-opener case passed in Chromium. Firefox's driver stalled during this interaction; Firefox/WebKit timeout behavior is therefore tested with an injected unresponsive popup handle. OAuth/enterprise provider integration is outside this synthetic authentication spike. The direct-popup harness uses an accelerated 1.5-second failure timeout; production timeout is configurable and bounded, not fixed to that test duration.

HTTPS virtual hosts use a restricted loopback CONNECT proxy, real hostnames/sites and a generated self-signed certificate. Browser certificate errors are ignored for that certificate; this verifies routing/origin/security behavior, **not public certificate issuance, wildcard DNS or a deployed ingress configuration**. Those are deployment checks against a chosen environment, not unresolved module design. No real DNS or deployment is needed to reproduce this proof.

This does not claim the new product integration is already shipped, physical Safari/iOS certification, or universal browser-policy support. It closes the proposed handoff and private-hosted-source design with executable evidence and names the exact supported fallback, rather than treating existing Strict cookies as a cross-site solution. Pairing approval additionally rejects an incorrect Origin, and public-ID polling with an attacker verifier is rejected in actual HTTPS requests.
