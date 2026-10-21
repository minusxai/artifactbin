# Markdown candidate validation

This is a bounded, executable candidate, not a new production component framework. All changes are confined to this directory. The `af-` prefix remains provisional.

## Decision

Select **markdown-it 14.3.3**, CommonMark preset, raw HTML disabled, no plugins, no automatic linkification/typography, and image tokens rendered as escaped alt text (no image fetches). Links retain markdown-it's unsafe-protocol rejection. This is intentionally a small documented dialect, not GFM. Do not enable HTML/plugins without revisiting the contract. Pin renderer version/options in historical source metadata.

Use static conversion as the default for bulk `.md` files and portable exports. Runtime `<af-markdown>` is an optional adapter for mixed authoring. It uses ordinary light DOM and a stable component-root `data-pagegi-id`. Generated paragraphs have no persistent identity promise. Both paths call the same pure renderer.

Generated source uses one direct-child `script[type="application/json"][data-af-source]` containing a JSON string, with every literal `<` escaped to `\u003c`. This preserves source characters including CRLF, leading/trailing whitespace, code examples, entities and closing-script text. Rendering follows CommonMark newline normalization; source retention does not normalize. Do not paste arbitrary Markdown as raw custom-element children.

API: `register({sourceCaptured})` registers once and fails on a conflicting renderer version. Each element waits for the resolved managed source-capture promise. Parsed initial JSON is complete at hydration; dynamically assembled elements call `setSource(completeString)` after registration. An empty element waits for this explicit commit. An empty string is valid and clears output. Reconnection reuses one generated output child. Source-update failures set `data-af-error` and retain prior rendered output. A host can surface this error; this candidate does not implement a UI error notification system.

Loader: `start({sourceCaptured, load})` scans once after parsing and inspects added subtrees. `load(attempt)` is a caller-controlled allowlisted pinned module import, never a URL derived from markup. No tag means no import. Multiple instances share one import. Failure is terminal until explicit `retry()`, with at most two attempts. In the browser test, attempts use two URLs for the same pinned bytes to avoid rejected-import cache reuse. There is no automatic retry or version fallback. `status: ready` means registration succeeded, while each element emits `af-ready` after rendering. Rendering stays blocked until source capture even if code downloads early. Shadow roots are outside this contract.

Offline policy is selected: exports pre-render semantic HTML by default, so neither JavaScript nor remote code is required. If a document explicitly needs runtime Markdown updates offline, embed the complete pinned bundle. A JSON source block alone is retained source, not a visible offline fallback; exporters must not describe it as formatted offline support.

Canonical export policy: source JSON + persistent root ID are authoring state; generated `[data-af-output]` is excluded from canonical authoring export. Portable static presentation exports intentionally include renderer output. A real adapter must pass this distinction through the source subsystem; this candidate validates that contract independently of the existing runtime. It must not capture live rendered DOM as canonical source.

## Evidence

In the earlier validation, the experiment dependency and renderer identity were pinned to 14.3.2 for [GHSA-r7fv-28h4-cvq7](https://github.com/advisories/GHSA-r7fv-28h4-cvq7); the [tagged changelog](https://github.com/markdown-it/markdown-it/blob/14.3.2/CHANGELOG.md) records the security backport. The affected smartquotes path requires typography, which this renderer disables. After upgrading, the existing strict typecheck, three renderer groups (including unsafe markup/protocol rejection), and all 21 browser scenarios passed again; the experiment dependency audit reported no known vulnerabilities.

The current 14.3.3 patch addresses [GHSA-gfr2-rv44-r23c](https://github.com/markdown-it/markdown-it/security/advisories/GHSA-gfr2-rv44-r23c) (quadratic multiline reference parsing, reachable with these options) and [GHSA-vfgh-jcmw-g37q](https://github.com/markdown-it/markdown-it/security/advisories/GHSA-vfgh-jcmw-g37q) (inline HTML parsing, already disabled here by `html: false`); see the [14.3.3 release](https://github.com/markdown-it/markdown-it/releases/tag/14.3.3). Strict typecheck, all four renderer groups and all 21 browser scenarios passed on 14.3.3; `npm audit` reported zero vulnerabilities. The new reference regression renders the advisory's approximately 400 KB unclosed-title input in a disposable child with a five-second deadline: 14.3.2 timed out, while 14.3.3 completed in about 339 ms including child startup on this machine. This is bounded regression evidence, not a cross-device latency guarantee. The earlier timing and bundle-size evidence below remains attributed to its original version. The 14.3.3 rerun measured parser/component ES module 151,303 bytes (53,871 gzip), lazy loader 1,295 (701 gzip), and offline IIFE 151,708 (54,099 gzip), using the same build script.

Contracts were written first, then renderer/browser behavior tests failed with the missing implementation, then implementation was added. Public renderer, element, registration and loader contracts are checked against the JS through strict TypeScript checkJs; declarations are not merely illustrative.

Commands from this directory: `npm ci`, `npm run check` (uses the repository's existing TypeScript/esbuild/Playwright toolchain). No root package changes. Browser fixtures are created in a disposable OS temp directory and removed. Generated bundle/result files are not committed.

Three pure test groups pass:

- Exact safe JSON encode/decode across empty strings, newlines, CRLF, tabs, quotes, Unicode, literal closing tags and entities; malformed and non-string JSON rejected.
- Heading/emphasis/list/code/hard-break semantics, explicit absence of tables/strikethrough/heading IDs, literal HTML in code fences.
- Raw HTML does not execute; javascript/data links do not become active links; HTTPS links work; images cannot fetch.

**21 browser scenarios pass**: seven each in Chromium, Firefox and WebKit, using the real bundled renderer:

1. Absent tag: zero module requests.
2. Initial tag: one request; no generated output before source capture; Unicode and fenced HTML render correctly; root ID preserved; light DOM; reconnect has one output; empty update works.
3. Late empty tag: one request; explicit later `setSource` renders complete source.
4. First import failure: explicit retry succeeds; exactly two requests.
5. Persistent network failure: two requests maximum; source remains intact.
6. Lifecycle/source export policy: duplicate registration idempotent; gate delays rendering; source round-trips; source update retained; generated output removed from authoring export; repeated blocks get no misleading durable paragraph IDs; invalid source reported.
7. `file://` first-open bundled rendering with HTTP(S) requests blocked, and pre-rendered static HTML with JavaScript disabled and HTTP(S) blocked.

The initial file test used Playwright's offline network emulation, which caused a WebKit internal navigation error on `file://`. Replacing this harness setting with explicit HTTP(S) request blocking allowed local file navigation and verified the intended no-network behavior in all engines. An initial Unicode test failure exposed missing document charset; fixtures now declare UTF-8, which is also an export requirement.

Measured minified bundle bytes after the 14.3.2 patch update (esbuild 0.25.12, gzip default):

| Payload | Minified bytes | gzip bytes |
|---|---:|---:|
| Actual parser + component ES module | 150,632 | 53,601 |
| Lazy loader | 1,295 | 701 |
| Complete offline IIFE parser + adapter | 151,037 | 53,842 |

No CSS/framework/highlighter/math/sanitizer payload. Raw HTML is disabled instead of permitting arbitrary HTML and sanitizing it. In the original validation run, one observed Node render of a 174,000-byte repeated-heading document produced 244,000 bytes in 35.0 ms on this machine; this is a measurement, not a cross-device latency guarantee.

## What this resolves

The source format, parser/options, unsafe content policy, offline export policy, source-capture handshake, late-source readiness, root identity, light DOM and bounded lazy-load policy now have selected executable candidates and regression evidence. They are no longer unanswered architecture choices. Production adoption would wire these contracts into the chosen source/boot pipeline and distribution path; this experiment does not claim an existing product integration, full CommonMark specification conformance, stable paragraph annotations, or arbitrary third-party plugin safety.
