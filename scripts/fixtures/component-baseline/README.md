# Actual reader comparison

This harness compares the original JSX compiler/reader against published HTML components. It never renders an invented baseline. The original pinned source is `8eaac63810b66eb575b018be89bb63443e1b7aaf`; use an isolated gate container built from that checkout. Candidate and original servers must have independent disposable storage. No production publication is allowed.

`gate-component-baseline.mjs` reads `COMPONENT_BASELINE__INPUT`, a JSON configuration file inside its container. Register `component-baseline` in the gate manifest before using the standard container gate runner. Gates are SLOW-tier: run once at the end of the brief, never per edit. The orchestrator coordinates the original and candidate container runs.

Publication configuration:

```json
{"mode":"publish","implementation":"jsx","base":"http://app.lvh.me:3030","source":"/workspace","output":"/workspace/tmp/original-readers.json"}
```

Use `implementation: "html"` with the candidate server and checkout for the candidate. Publication uses the owning checkout's normal gate authentication and real HTTP API. The generated URL manifest is the capture configuration: run the same gate with `COMPONENT_BASELINE__INPUT` pointing at it. It records explicit source revision, fixture hash, image hash, browser errors and behavior for every state. Keep the manifests and images together. Compare configuration:

```json
{"mode":"compare","baseline":"/evidence/original/jsx-captures.json","candidate":"/evidence/candidate/html-captures.json","baselineDirectory":"/evidence/original","candidateDirectory":"/evidence/candidate","output":"/evidence/diffs"}
```

Comparison emits diagnostic images and exact changed-pixel fractions. Any changed pixel, behavior difference, missing case, hash mismatch or page error prevents a parity pass. Unequal pixels require visual inspection and a reasoned correction; the tool does not grant an arbitrary tolerance.

Current coverage is six families and 48 states per implementation: Button, Dialog, Tabs, Select, FileUpload and DataTable at 800×600 and 390×844, light and dark modernist theme. FileUpload covers only the unavailable static face, and DataTable covers initial rendering of identical query data. Selection persistence, actual uploads/retry/permission, table sorting/editing/virtualization, the remaining 20 families and cross-browser comparison remain outstanding. These fixtures are preparation until both actual reader runs have completed; unit tests and candidate-only screenshots do not establish visual parity.
