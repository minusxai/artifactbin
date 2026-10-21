# Canonical readable-source gate: executable candidate

Status: **planning gate closed for the chosen managed document contract**. This is a tested candidate codec and boot adapter, not a claim that the shipping product was migrated. No account credentials, remote services or production files are used.

Run from repository root (root dependencies must already be installed):

```sh
npm ci --prefix experiments/readable-html/source --ignore-scripts
npm run --prefix experiments/readable-html/source typecheck
npm run --prefix experiments/readable-html/source test
```

`contracts.ts` preceded the tests. The initial pure test failed with missing codec; the initial browser test failed with missing boot adapter. `api-check.ts` binds the checked JavaScript implementation to its public TypeScript contract and verifies invalid state/envelope calls do not compile. The isolated dependency lock pins parse5 7.3.0; no root dependency/configuration changed.

## Chosen authority and boot pipeline

1. Authoring/import uses `decode(html, {runtime: knownRuntimeBytes})`. The **same pinned parse5 parser and serializer** runs on server and browser. There must be exactly one head runtime marker, followed by one state metadata script. Unknown nonempty runtime contents are rejected, not silently discarded. Empty runtime markers are allowed in authoring source; the assembler inserts the known runtime build for execution. Runtime identity/version is format-owned, not arbitrary author code. Once shipped, a runtime version must map to immutable build bytes; changing those bytes requires a new version/compatibility decision. The experimental version 2 is not a shipped release. Pinned identity refers to the **final HTML-safe emitted bytes**, after the build escapes raw script terminators and problematic control characters inside JavaScript strings. Do not globally escape less-than operators in JavaScript. The independent composition experiment exercises this packaging with the larger Markdown bundle; unknown or unencoded runtime bytes are not silently accepted.
2. App startup code is inert `type="application/pagegi"` content. The inline bootstrap registers a once-only DOMContentLoaded listener. Before executing any managed app code or optional extension/component upgrade, it serializes the parsed document exactly once and canonicalizes it. The source stays immutable in closure memory; subsequent rendering is never the export authority.
3. After capture/digest succeeds, managed blocks run in document order, with a local `pagegi.init()` API. They can render, register handlers and load explicitly online dependencies then. Their authored source remains readable in the original inert blocks. This candidate uses `Function` and therefore the managed execution CSP must permit this deliberate mechanism; choosing a module/blob adapter later must preserve capture-before-execution semantics.
4. `decode` returns `{source,state,revision}`. `source` is an **internal canonical template** with empty runtime/state blocks, not an executable export. `save(source,state)` serializes explicit validated state into that template. The runtime download method inserts its pinned runtime bytes itself; the browser harness writes those exact exported bytes and reopens them directly, without a repair or assembly step. No duplicate base64 app source is embedded.
5. Agent-readable source is `save(canonicalSource, stateProjection)`; a source-only projection may use `{format:2,app:null,comments:[]}`. Push changes source only; it must not overwrite the repository's independently retained app snapshot from that projection. A full download uses the actual captured snapshot. The workflow experiment separately tests this separation.

Illustrative authoring input (the assembler fills the runtime marker):

```html
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <script data-pagegi-runtime="2"></script>
    <script id="pagegi-state" type="application/json">
      { "format": 2, "app": { "count": 0 }, "comments": [] }
    </script>
  </head>
  <body>
    <h1 data-pagegi-id="title">A readable counter</h1>
    <button data-pagegi-id="increment">Increment</button>
    <script type="application/pagegi">
      const state = pagegi.init();
      const button = document.querySelector('[data-pagegi-id="increment"]');
      button.addEventListener('click', () => { state.count += 1; });
    </script>
  </body>
</html>
```

The candidate's tiny app API is illustrative, not a substitute for the existing immutable JSON store implementation. Product composition reuses the store behind this managed lifecycle.

## Exact revision policy

`SHA-256(UTF8("pagegi-readable-v2/parse5-7.3.0\\n" + canonicalSource))`.

- Runtime and state **contents** are empty in canonicalSource. Format/runtime version and structural placement remain. State updates do not change source revision. Changed authored text/script/style/IDs do.
- Entity spellings, quote syntax, tag case, doctype spelling/identifiers and line endings normalize through shared HTML parsing/serialization. Document-level comments before and after the root are retained; capture walks every document child, using XMLSerializer for doctype and HTML serialization for elements. Optional/repaired closing markup normalizes when parse5 accepts it. Reported parse errors (including duplicate attributes, absent doctype and null characters) are rejected. This is structural source preservation, not byte-exact preservation or a promise to accept arbitrary malformed HTML.
- Unicode is preserved; no NFC normalization is applied. Invalid UTF-16 and nulls are rejected. Text and raw script/style content use the shared serializer; JSON escapes `<` so `</script>` never terminates metadata.
- Attribute order is retained. Reordering attributes can create a revision; equivalent-looking HTML need not collapse to one semantic revision. Cross-engine identity is required for the same accepted source.
- Explicit `data-pagegi-id` values are preserved. Duplicate or empty IDs reject the document. Missing IDs are not silently generated by this codec; an authoring operation can explicitly add an ID and create a revision. Removed IDs remain historical references; no reassignment is implied.
- Reserved state/runtime markers cannot occur twice or on wrong elements, including inside template contents. Envelope fields are exactly `format`, `app`, `comments`; privileged top-level fields are rejected. This is not a magic secret detector: arbitrary app strings can contain secrets, so credential isolation must ensure platform secrets never reach this realm.

## Dependencies and unmanaged HTML

The portable profile embeds JavaScript/CSS/data assets. SVG, MathML, ordinary external navigation links, Unicode and script-like strings are supported. Eager executable scripts, event-handler attributes, active frames/object/embed, base/noscript, meta HTTP directives, external resource URLs, external script files and stylesheet imports are rejected. Frames or explicitly online resources can be created by managed app code **after** capture; the source codec does not police later app network activity. CSS is parsed by pinned **css-tree 3.1.0**, including custom-property values, with parser recovery/Raw nodes rejected. Normal resource-free `@media`, `@supports`, `@keyframes`, gradients, variables, escaped identifiers and URL-looking string content are accepted. AST checks decode escaped names and reject `@import`, external URL nodes and dynamic/string resource constructors (`src`, `image`, `image-set`, `cross-fade`, `attr`, including vendor forms where relevant). Fragment/data URLs work in CSS, including SVG paint references. The same parser checks style attributes and SVG presentation attributes; there is no regex-only CSS acceptance rule. Multi-URL HTML attributes (`srcset`, `imagesrcset`, `ping`) and declarative SVG animations/mutations are rejected. URL classification handles namespace-local `href` (including `xlink:href`), trims URL whitespace and strips embedded tabs/newlines before rejecting script schemes; ordinary HTML/SVG navigation links still work. The CSS validator changes acceptance, not source serialization; raw authored CSS is retained in the source hash.

These restrictions protect a definite startup/offline contract. “Just add a script” to arbitrary active HTML still provides instrumentation, comments and presence; it does **not** gain deterministic managed snapshots. A manually edited unsupported early script might already run in the browser, but managed capture rejects the document, and authoritative import/push rejects it before serving it. It is not safe to claim that a late validation error undoes arbitrary JavaScript. App code remains untrusted relative to platform credentials in both profiles.

## Evidence

Final run: pure behavior suite passes; checked public API passes; **36 browser cases** pass: eleven fixtures and one unmanaged-script rejection in each of Chromium, Firefox and WebKit. Every accepted browser fixture checks server/browser source equality and revision equality, rendered-content exclusion, state-change revision stability, fresh saved-file reopening, exact script-like state restoration, stable authored IDs and byte-idempotent second save. Fixtures cover Unicode/entities, repaired closing tags, attribute normalization, raw script/style text, script-like JSON, SVG+MathML, external navigation links, CRLF, document-level comments before/after the root the accepted legacy-compat doctype, and responsive CSS with media/supports/keyframes. HTTP(S) requests are blocked during fresh file opening. Pure negative cases cover ambiguous metadata/runtime, unknown runtime bytes, unmanaged scripts/handlers, duplicate IDs/attributes, external script dependencies, active frames, privileged envelope fields, nulls and invalid JSON.

One harness bug was corrected: runtime assembly originally matched an exactly empty runtime block and failed to inject into a CRLF fixture. Assembly now replaces whitespace too; the successful final run includes CRLF. This was a test-assembler failure, not evidence that the format works without normalization.

Minified candidate bootstrap + parser + codec: **251,671 UTF-8 bytes; 68,538 gzip bytes**. Before HTML-safe packaging, emitted HTML parser dependencies account for 180,080 bytes and the CSS parser for 63,820 bytes. Build-only Acorn is excluded from the browser bundle. This is not a tiny source shim, and excludes the real state store/UI/collaboration runtime. The decision here buys identical local/server normalization with a shared parser. A future optimization may retain the pre-mount snapshot synchronously and load the codec only when hashing/exporting, but an offline export must include that codec; it cannot depend on a remote download. No unmeasured smaller-core claim is made.

The remaining work is integration of these chosen contracts into the shipping format/runtime, which is Phase 1 implementation. The former planning ambiguity (source authority, canonical digest, startup order, serialization boundaries and dependency policy) now has a concrete candidate and passing executable evidence. Tests establish the stated bounded contract, not universal support for arbitrary browser DOM or arbitrary JavaScript.

Independent review found and reproduced two candidate defects: URL/CSS dependency bypasses (srcset, namespace-local SVG href, escaped CSS, whitespace-obfuscated script URLs) and capture losing document-level comments. New negative tests failed before the fixes. The codec now rejects those bypasses and SVG presentation resource references; a shared full-document capture helper resolves comment/doctype divergence. The final 36-case browser rerun and API checks pass after these corrections.

A subsequent review correctly rejected the initial overly narrow CSS at-rule ban. It was replaced with the real CSS parser above. Adding that parser exposed an HTML packaging issue: literal `<!--` followed by `<script` strings in a JavaScript bundle can put the HTML tokenizer into double-escaped script state. `packaging.mjs` now uses build-only **Acorn 8.15.0** to rewrite parsed string literals and untagged template chunks without changing their values or executable operators. It escapes HTML-sensitive characters and control/non-ASCII string data, preserves template interpolation, reconstructs HTML-sensitive regex literals through the standard RegExp constructor preserving pattern/flags, rejects residual unsafe tagged-template syntax, and reparses the output. Packaging behavior tests verify operators, C0/C1 controls, Unicode, script/comment text, escaped backslashes, templates String.raw semantics and escaped directive spelling (which must not accidentally enable strict mode). This build tool is not included in the browser bundle; runtime identity is pinned after packaging.
