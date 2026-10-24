# Actual reader comparison

This harness compares the original JSX compiler/reader against published HTML components. It never renders an invented baseline. The original pinned source is `8eaac63810b66eb575b018be89bb63443e1b7aaf`; use an isolated gate container built from that checkout. Candidate and original servers must have independent disposable storage. No production publication is allowed.

`gate-component-baseline.mjs` is self-contained without configuration: it publishes candidate HTML through normal gate authentication and the HTTP API, then captures and checks the 48 candidate states. This default proves candidate reader behavior only. Register `component-baseline` in the gate manifest. Gates are SLOW-tier: run once at the end of the brief, never per edit. The orchestrator coordinates the original and candidate container runs.

For paired evidence, copy this harness's script files into an isolated original-source worktree without modifying its product implementation. Register the gate there. Put an untracked optional configuration file at `scripts/fixtures/component-baseline/run.json` (the container runner copies untracked nonignored source files). Run the normal `node scripts/gate-container.mjs component-baseline`. No environment forwarding or production writes are needed. The optional file must never be committed.

Original configuration (replace the source revision with the exact verified original Git revision):

```json
{"implementation":"jsx","sourceRevision":"8eaac63810b66eb575b018be89bb63443e1b7aaf","output":"/work/tmp/original-evidence"}
```

Use `implementation: "html"`, the candidate's full Git revision and a candidate output path for the candidate container. These modes publish and capture within the same server/container lifecycle, so disposable reader URLs never outlive their server. Optional `source` defaults to the current container checkout; gate runner's server base is passed automatically. Explicit `mode: "publish"` is available only for debugging publication inside an already running server.

Capture archives are emitted as `COMPONENT_BASELINE_EVIDENCE_GZIP_BASE64` log lines: decode base64, gunzip, parse the JSON and write each file's decoded base64 under its name. This preserves the images and capture manifest after container teardown. The archives carry source revision, fixture and image hashes, browser errors and behavior. Default candidate runs use an explicitly labeled source hash, which comparison refuses as a substitute for verified Git provenance.

To compare extracted evidence, use optional config:

```json
{"mode":"compare","baseline":"/evidence/original/jsx-captures.json","candidate":"/evidence/candidate/html-captures.json","baselineDirectory":"/evidence/original","candidateDirectory":"/evidence/candidate","output":"/evidence/diffs"}
```

Captures use the configured page viewport (not the HTML element box), retaining top-layer dialogs and popovers. `screenshotMode: "viewport"` distinguishes these from earlier cropped diagnostics. Raw snapshots remain in the capture manifests. Comparison only normalizes empty native button values and whitespace between a body made solely of button labels; it preserves actual label, content, focus and selection differences. File inputs are recorded as file-input diagnostics rather than textboxes; native dialogs are included even when their role is implicit.

Comparison emits diagnostic images and exact changed-pixel fractions. Any changed pixel, behavior difference, missing case, hash mismatch or page error prevents a parity pass. Unequal pixels require visual inspection and a reasoned correction; the tool does not grant an arbitrary tolerance.

The integrated catalogue prepares 25 root component families (including authored Slide children) and 224 captures per implementation: 56 states at two viewports and two color modes. Each state can assert named roles and value/checked/pressed/expanded/disabled/focus state, visible or absent text and exact table rows. Assertion failures are retained beside raw snapshots and fail either reader's gate. Real Mermaid image, Isometric geometry and WebGL2 readiness are required. Two workers run in separate Chromium instances with identical options, preserving native focus independence and deterministic result order.

FileUpload still covers only its unavailable face; actual uploads/retry/permission need equivalent adapters. User covers no-person fallback; Avatar covers network-free fallback/group states. Zoom/reset controls and engine readiness are checked, while numeric map view-state is not exposed by the original reader. Limitations remain on each fixture. These preparations and successful individual reader gates are not old/new visual parity; both reader captures and their comparison remain required.
