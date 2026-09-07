# Visible-frame workload validation (planning only)

No product code changes. This probe executes the captured ocean author script unchanged, with its existing `artifact.library('three')` mapped to the generated Three 0.185.1 ESM bundle. The captured third-party script is a local input, not committed.

```sh
node scripts/planning/ocean-workload-perf.mjs /path/to/capture.txt webkit 2 1
node scripts/planning/ocean-workload-perf.mjs /path/to/capture.txt webkit 1 1,4,8 --cube
node scripts/planning/ocean-workload-perf.mjs /path/to/capture.txt chromium 1 1 --headed
node scripts/planning/ocean-workload-perf.mjs /path/to/capture.txt chromium 1 1 --headed --shapes=wrapper
node scripts/planning/ocean-workload-perf.mjs /path/to/capture.txt chromium 3 1 --headed --shapes=wrapper --defer-inner
node scripts/planning/ocean-workload-perf.mjs /path/to/capture.txt chromium 1 1 --interactive
```

Interactive mode only starts disposable loopback servers (7024 parent, 7025 public assets). `/top`, `/iframe?n=1`, `/wrapper?n=1` expose the same scene. Stop with SIGINT. No automatic bundler, external asset proxy, or authenticated API access.

## What is measured

- Cycled top/single/nested order across samples; fresh context per shape; cold then repeated navigation in the same context. Actual asset-server hits distinguish a cache hit from a faster request.
- First completed render call, render CPU-call durations, 35-render passive cadence, 35-render cadence after actual controls clicks, browser activation flags, supported long tasks, real pause/ripple/range-keyboard interaction, and 390px-wide resize.
- Four concurrent fixed 2 MiB GET resources, repeated twice, with exact byte counts and server request accounting.
- Explicit author `pagehide` cleanup, active animation callback/ResizeObserver counts, known scene resource IDs, renderer resource counters, and three natural frame-removal cycles.
- Cube mode varies visible renderer/frame count 1/4/8; it is not eight copies of the expensive ocean workload and not a bound on arbitrary author resource consumption.

## Methodology corrections and limits

Playwright frame evaluation can emulate user activation. The final probe emits passive measurements autonomously through console/postMessage before **any** evaluation or inspection in any page/frame. The next sample is armed by a real click handler. Earlier ocean results from `/tmp/afbin-ocean-webkit.json` used frame evaluation before measuring; their 17ms cadence is not a trustworthy passive-animation baseline.

The initial Chromium headless run used SwiftShader and consumed substantial CPU; it was stopped, not recorded as an iframe performance failure. A separate instrumentation error (Three defines render as an instance method, not a prototype method) was fixed before the completed preliminary WebKit run. Headed Chromium uses ANGLE Metal when available and reports the actual exposed renderer.

The scene has approximately 256k triangles, 1,200 particles and 56 draw calls per frame in this capture. Browser render-call durations exclude asynchronous GPU completion and are not input-to-photon latency. Laptop DPR1/mobile-sized viewport is not physical mobile validation. Browser GPU/heap reclamation cannot be proved by `dispose()` call counts, missing child frames, or zero scheduled callbacks; natural teardown reporting can itself be dropped during document destruction. No unbounded canvas/frame count or memory safety claim.

## Results

**Open reproducibility issue:** headed Chromium's repeated-navigation strict-wrapper case did not publish its passive sample within 60 seconds, with no page/console error. The other five cold/warm cases passed on ANGLE Metal (Apple M5 Pro). This is not a clean Chromium matrix; a targeted rerun with failure diagnostics is required before claiming reliable repeated startup. The probe now accepts `--shapes=wrapper` and captures frame state after a timeout; those diagnostics were not present in the initial failing run.

The independent default rerun reproduced the stall: the wrapper's script executed and created an inner iframe with nonempty srcdoc and a contentWindow, but no author context was reported. The optional `--defer-inner` experiment creates that same inner iframe after the outer window's load event plus one task. It changes neither content nor CSP and is **not the default or an established fix**; compare repeated default/deferred cases before attributing the cause. Natural-removal readiness now fails explicitly if no author bootstrap appears rather than evaluating an undefined `metrics` global in the wrapper.

In the five completed headed Chromium cases, passive and post-control render-call cadence was 8.2–8.4ms. The cold top-level first render paid substantial initial warmup (687ms versus 222–225ms for later framed shapes), so this single fixed-order run is not a valid numeric iframe-overhead comparison. Large resource requests also differed: top-level had four network hits then zero on its second pass (and zero on warm navigation); opaque frames re-requested all four resources on both passes. This strengthens the requirement to measure/cache at the trusted asset layer rather than assume browser cache reuse across opaque contexts.

WebKit 26.5, Apple GPU, Apple M5 Pro/18 cores, two cycled samples per shape, cold and repeated navigation each. Every passive sample recorded `userActivation.isActive=false` and `hasBeenActive=false`; subsequent real controls samples recorded both true. No page errors or measured-case failures. Timings below are observed ranges, not a production percentile promise.

| Exact ocean | First render cold (ms) | First render repeated navigation (ms) | Passive render cadence | After controls |
|---|---:|---:|---:|---:|
| Top page | 247–278 | 201–211 | 17ms | 17ms |
| One opaque iframe | 235–251 | 200–201 | **50ms** | 17ms |
| Strict wrapper + author iframe | 244–245 | 202–204 | **50ms** | 17ms |

This clean passive-phase result confirms that the actual ocean also encounters slower WebKit scheduling in opaque frames before interaction. It is not a Three compatibility failure, and nested framing did not worsen that measured limit. The test does not establish which specific browser policy causes it. Physical Safari/iPhone remains unverified.

The exact ocean rendered successfully, the real controls worked and the canvas resized to 390×808. Repeated navigation avoided an additional Three module request, but repeated 4×2MiB resources still hit the asset server on **both** passes (four requests per pass) despite immutable headers and explicit binary content type: **do not assume arbitrary resource loads are cached**. This is local-loopback transport, not WAN throughput measurement.

WebKit cube scaling, one cold/warm sample per shape/count:

| Visible cubes | Single-frame layout first render range, cold | Nested layout first render range, cold |
|---|---:|---:|
| 1 | 25ms | 26ms |
| 4 | 28–56ms | 32–69ms |
| 8 | 25–105ms | 43–126ms |

All cubes rendered and controls/resize succeeded, no recorded context losses/errors. Passive cadence was 50ms in every framed cube. As focus moved across sibling frames after interaction, render-call intervals ranged approximately 3–17ms; these timings are **not screen-presentation FPS**. All cube renderer counters reached zero geometries/textures/programs after explicit cleanup. Counts above eight, heavier multi-canvas scenes, physical mobile and sustained memory pressure are not validated.

Explicit ocean pagehide invoked renderer cleanup, 56 geometry/41 material/2 texture disposal IDs, and left zero tracked animation callbacks/observers. Renderer counters reached zero geometries/programs but retained **one texture**; counters can include internal engine resources and do not prove actual memory reclamation. Twelve natural ocean iframe removals in the final two-sample run produced no disposal messages. This is not proof of a leak, but relying on a teardown acknowledgement after removal is not a robust lifecycle contract; an explicit pre-removal dispose/acknowledge sequence with a timeout is the safer proposed lifecycle.

Raw evidence (local, not committed):

- `/tmp/afbin-ocean-webkit-autonomous.json` — final passive-safe ocean matrix.
- `/tmp/afbin-cube-scale-webkit.json` — 1/4/8 cube scaling matrix.
- `/tmp/afbin-ocean-chromium-headed.json` — headed hardware-path cross-check, **one unresolved timeout**.

Compact, source-free evidence is committed in `results/ocean-workload-2026-09-07.json`. The runner preserves its JSON result and returns a nonzero exit code for recorded failures or page/console errors; the initial failing Chromium run predates that exit-code correction and must be judged by its recorded failure.

No blanket performance/security signoff: passive WebKit scheduling, resource-cache behavior, lifecycle ownership and real-device/resource-budget acceptance still need explicit product decisions.
