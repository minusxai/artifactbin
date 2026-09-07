# Managed iframe: state, scheduling and lifecycle validation

September 7, 2026. Planning evidence, not implemented managed-Iframe support or
production performance certification. Read alongside `MANAGED-IFRAME-VALIDATION.md`
and `OCEAN-WORKLOAD-PERF.md` for navigation, assets and the real rendering workload.

## Decisions

- Keep isolation. The extra wrapper is not the dominant measured state cost.
- **Do not ship full dataset snapshots for every scalar change.** Implement named
  subscriptions, changed-value/table delivery and bounded latest-state queues.
  Coalesce replaceable state, never mutation commands or required acknowledgements.
- Do not promise continuous background/offscreen execution, or passive WebKit
  animation parity. Keep authoritative live state in the parent; resume from a
  fresh snapshot when a managed region becomes active again.
- Explicitly dispose channels, subscriptions and author resources. Frame removal
  alone is not proof of GPU resource reclamation or a hard memory quota.

## Reproduce / method

Run separately, without another browser benchmark competing for CPU/GPU:

```sh
node --import tsx scripts/planning/iframe-state-perf.mjs chromium --headed
node --import tsx scripts/planning/iframe-state-perf.mjs firefox --headed
node --import tsx scripts/planning/iframe-state-perf.mjs webkit --headed
S3_URL='' node scripts/gate-trusted-controls.mjs --measure-perf --browser=chromium
```

The state probe imports the **actual author bootstrap and parent request bridge**.
The state producer is synthetic, not SSE or a database. The experimental delta
branch changes only scalar delivery and leaves unchanged tables in child state.
Top-level uses direct DOM updates; single/nested use a transferred private port.
The wrapper transfers the port once, not on every message. Thirty measured serial
updates follow five warmups per case; bursts contain 100 unpaced updates. The
matrix includes 0/1,000/10,000 rows, 1/4/8 regions, and 200 concurrent requests.

Raw final headed results, including browser versions and limitations:
`results/iframe-state-2026-09-07.json`. Values below are one local run, not an SLA.
Small cross-realm timing differences below clock precision are not meaningful.

## State / scale / backpressure

| Nested frame, 10,000 unchanged rows | Chromium | Firefox | WebKit |
| --- | ---: | ---: | ---: |
| Current full-state 100-update drain | 386.5 ms | 910 ms | 838 ms |
| Experimental values-only drain, all 100 delivered | 6 ms | 8 ms | 5 ms |
| Same-turn latest-state coalescing, one final state | 5.9 ms | 8 ms | 9 ms |
| Current serial signal-to-DOM median | 2.3 ms | 5 ms | 4 ms |
| Values-only serial median | 0.1 ms | 1 ms | 0 ms* |

*Below timer resolution, not literally free. Burst drain includes a 5 ms polling
interval. The same full-state problem exists in a single frame (385/910/828 ms):
removing the protective wrapper would not solve it. Coalescing here proves only
same-turn replacement; sustained producer-over-consumer load still needs a
bounded queue/version protocol in the product, with ordering and resync tests.

One hundred small updates to eight nested regions delivered all 800 observations
in 18.3/16/8 ms. These are bridge-scale tests, not eight complex WebGL scenes.
Two hundred simultaneous `mx.mutate` calls exercised the actual bootstrap and
parent bridge with a zero-cost fake executor: 128 reached the wire, 120 succeeded,
80 rejected (72 in-flight limit, 8 parent rate limit), in every engine/layout.
This proves bounded rejection behavior, not server mutation throughput. The real
server's separate rate limit remains enabled; do not bypass it for benchmarks.

## Scheduling is more than requestAnimationFrame

Preinstalled child samplers receive commands from the top page and return counters.
No child evaluation happens before passive samples: Playwright can synthesize
user activation during evaluation, which confounded earlier measurements.
Samples are approximately 500 ms; a real button click starts the interacted phase.

| Behavior | Chromium / Firefox | WebKit |
| --- | --- | --- |
| Visible opaque frame, before click | About 60 animation callbacks/sample | 10 callbacks vs top-level 30 |
| After real in-frame click | About 60 callbacks/sample | 30 callbacks/sample |
| Offscreen opaque frame | 0–2 animation callbacks; timers continue | 0 animation callbacks; 0–1 timer callbacks vs visible 18 |
| CSS-hidden opaque frame | 0 animation callbacks; timers continue | 11–12 animation callbacks and 16 timers in this short test |
| Local MessageChannel burst | All 100 delivered | All 100 delivered, including offscreen |
| Click dispatch-to-handler | 0–2.8 ms measured | 0–1 ms measured |

Click dispatch timing is not INP or input-to-paint. CSS-hidden WebKit behavior is
an observation, not a promise to animate invisible content. **Actual background
tab behavior remains unverified:** even headed `bringToFront` left the measured
document's `hidden` flag false. Those samples are retained and explicitly must
not be called background passes. Device/OS power-saving can differ.

## Lifecycle

Thirty cycles mounting/removing four nested regions leave zero retained fixture
ports/frames. A separate 30-cycle test of the actual `startAuthorScript` and its
disposer leaves zero store subscriptions and frames in every engine. Chromium
forced-GC DOM counters return exactly to baseline: one document, 11 nodes, one
listener, also after the product lifecycle run. Firefox/WebKit have no equivalent
memory measurement in this probe. These bounded tests do not establish GPU memory
reclamation, long-session heap stability or a CPU/memory quota.

## Real edit/mutation transport

`--measure-perf` extends the real two-origin controls gate, not a mock route. It
alternates direct calls **inside the trusted iframe** with the parent relay for
the same stored operations; it does not add a privileged main-host endpoint.
Eight pairs per operation discard two warmups (six measured samples/path), within
the actual server rate limit. All 32 writes must target the controls origin.
Inline editing measures fill through the actual save response, including debounce.

All three full controls gates passed with the optional measurement enabled.

| Median, ms | Chromium | Firefox | WebKit |
| --- | ---: | ---: | ---: |
| Local SQL direct / relay | 9.0 / 9.1 | 9 / 10 | 9 / 10 |
| Persistent write direct / relay | 12.5 / 15.3 | 11 / 14 | 13 / 16 |
| Inline edit fill through save (includes debounce) | 564.7 | 564.6 | 561.8 |

All 32 requests per engine reached only the controls origin. No large local relay
penalty was observed, but this tiny localhost sample is not a production
tail-latency claim. Raw results: `results/interaction-perf-2026-09-07.json`.

## Release conditions, not invisible assumptions

Implement and integration-test delta/filter/coalescing semantics, bounded asset
work, explicit cleanup and resume/resync behavior before calling the new primitive
ready. Stage the exact HTTPS/cookie/CDN configuration, test real mobile devices
and actual backgrounding, and test failure/retry/disconnect with real data updates.
No Chrome DevTools MCP was available, so this is not a Core Web Vitals/trace audit.
Arbitrary author JS can still consume CPU/GPU; sandbox isolation is not a resource
quota. Keep these limitations visible rather than weakening origin protection.
