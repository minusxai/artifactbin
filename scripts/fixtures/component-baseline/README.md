# Actual reader comparison

This harness compares the original JSX compiler/reader with published native HTML components. The pinned original is `8eaac63810b66eb575b018be89bb63443e1b7aaf`; use an isolated gate container built from that checkout. Copy only the matching harness scripts into the original checkout, retain its gate manifest with the component-baseline row added, and leave its product implementation unchanged. Each server has independent disposable storage. Publication uses normal local authentication and HTTP APIs; never publish these fixtures to production.

## Independent scopes

The default static catalogue has **28 fixtures, 65 states and 260 captures per implementation**: each state runs at two viewports and in two color modes. It covers component interactions, rich rendering, table behavior, fallback identity and unavailable upload presentation. Mermaid images, Isometric geometry and WebGL2 readiness are actual reader checks. Numeric map view-state is not exposed by the original reader. Fixture-specific limitations still apply.

The explicit **`fixtureSet: "identity"`** adds **3 fixtures and 12 captures per implementation**: User with its real handle and no avatar, User with a real profile image, and Avatar with that uploaded image, at the same two viewports and color modes. It seeds a disposable account through normal OTP/profile APIs and a dataset with a typed user column. Original User resolves its actual page-data people; native User requests actual cards through the authorized linked dataset namespace. A synthesized person card is not parity evidence. Session cookies stay in memory; manifests contain only the disposable account reference needed for normal login.

The static FileUpload fixture covers its unavailable face. Neither the static catalogue nor the identity suite proves actual file upload, retry or permission behavior. Those require a separate live upload suite and its actual server responses/readback. Likewise, fallback User/Avatar captures do not substitute for the authenticated identity suite. Private native migration captures are a separate scope documented in `scripts/gates/README.md`.

Individual reader gates check behavior and readiness; they do not establish old/new visual equality. Both captures, matching inputs, comparison and visual review remain necessary.

## Run a matched capture

Gates are SLOW-tier: run once at completion of the brief, never per edit. The orchestrator coordinates CPU slots, source pins and original/candidate runs. The gate without configuration publishes and validates the 260 candidate static states; its source snapshot hash is explicitly not verified Git provenance and cannot establish a paired result.

For paired runs, use each implementation's exact full Git revision. An original input is:

```json
{"implementation":"jsx","sourceRevision":"8eaac63810b66eb575b018be89bb63443e1b7aaf","output":"/component-evidence"}
```

For the candidate use `implementation: "html"` and its actual revision. Add `"fixtureSet":"identity"` to run the independent 12-state identity suite. The default source is the container checkout, and the gate runner supplies its actual server base. Publication and capture occur within that same disposable server lifetime.

Prefer an external private JSON input and explicit private output directory:

```sh
COMPONENT_BASELINE__INPUT=/absolute/private/capture.json \
COMPONENT_BASELINE__OUTPUT=/absolute/private/evidence \
node scripts/gate-container.mjs --servers 1 component-baseline
```

The input file mounts read-only at `/component-input.json`; only the specified output directory mounts writable at `/component-evidence`. Both paths must be absolute. Runtime input changes can reuse the same immutable source build; capture fixture hashes still identify the actual scenario inputs. An untracked `scripts/fixtures/component-baseline/run.json` is also supported, but its contents affect the container build cache key. Never commit a run configuration, credentials or generated test data.

Native candidate publication checks the installed skill ZIP's complete component module closure against a source-bound build receipt. `component-assets.json` preserves the actual module hashes and input proof. A cache hit alone is not proof of current generated assets. Original JSX capture does not require native component build outputs.

## Evidence and comparison

Capture evidence includes source revision, browser version, screenshot mode, fixture/image hashes, raw behavior, actual used-font bytes, resource failures and assertion results. `capture-status.json` records completion; failed captures retain partial manifests and failure diagnostics instead of becoming a successful baseline.

After teardown, explicit output mounts retain the files. Logs also carry a V2 chunked archive: `COMPONENT_BASELINE_EVIDENCE_V2_BEGIN`, ordered `COMPONENT_BASELINE_EVIDENCE_V2_CHUNK` lines, and a matching `COMPONENT_BASELINE_EVIDENCE_V2_END` receipt with digest, byte and chunk counts. Decode with `scripts/component-baseline-decode.mjs`; the decoder checks completeness and rejects a truncated latest attempt. Legacy `COMPONENT_BASELINE_EVIDENCE_GZIP_BASE64` archives remain readable.

Static readers use `/raw` and `screenshotMode: "viewport"`, retaining top-layer dialogs/popovers. Authenticated identity readers use the normal `/a/<id>` shell, a verified signed-in session and the actual isolated document frame; `screenshotMode: "document-frame"` captures that iframe. Readiness belongs to the actual frame, components, fonts and resources; live shell transports need not become network-idle. Do not compare unlike screenshot modes or normalize away product differences.

To compare retained captures, use `compareBrowserBaselines` from `scripts/lib/component-browser-baseline.mjs`, or the gate's explicit compare input within a container that can read those evidence paths:

```json
{"mode":"compare","baseline":"/evidence/original/jsx-captures.json","candidate":"/evidence/candidate/html-captures.json","baselineDirectory":"/evidence/original","candidateDirectory":"/evidence/candidate","output":"/evidence/diffs"}
```

Comparison requires exact matched fixture hashes, verified source revisions, screenshot modes and image hashes. It records exact pixel changes, behavior and font evidence; any missing case or error prevents a parity pass. The limited behavior normalization handles empty native button values and whitespace between button-only body labels, preserving actual labels, content, focus and selection. Nonzero pixels require visual inspection and correction, with no arbitrary tolerance. Behavior equality alone is not visual parity.
