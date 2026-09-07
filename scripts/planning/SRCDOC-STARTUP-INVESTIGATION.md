# Nested srcdoc startup investigation — 2026-09-07

Decision: retain sandboxed srcdoc plus protective wrapper. **The claimed startup blocker was a false-red observation.** The author renders and sends messages even when Playwright omits its console and frame entry. Do not use those missing observations as proof of missing execution.

## Corrected evidence

The same ocean fixture, sandbox, CSP and author code passed 30/30 reloads and 30/30 fresh contexts when observed through its existing author-to-parent phase1 message. Each message followed 35 actual renderer calls, with user activation false. The main reviewer independently repeated 30/30 successful reloads; 26 of those still lacked child-console/frame visibility. No security flags changed and no author-frame evaluation occurred.

Raw logs: `/tmp/afbin-ocean-parent-cold.jsonl`, `/tmp/afbin-ocean-parent-reload.jsonl`, `/tmp/afbin-ocean-parent-root-review.jsonl`. Reproduction: `node scripts/planning/ocean-parent-readiness.mjs CAPTURE_JSON [--cold]`.

These findings resolve the claimed execution/startup blocker, not every integration or device gate. Exact attribution of the automation observation defect to Playwright vs CDP remains unassigned. Integrated tests must use source/channel-validated parent-visible readiness and real interaction outcomes.

## Earlier evidence — observation failures, not proven execution failures

| Probe | Result |
| --- | --- |
| Chromium 151 reduced fixture: depth 1/2, source padding 0/25 KB, CSP on/off; then grid + HTTP CSP | 160/160 loads passed |
| Exact ocean shell, author replaced with static text, default Chromium 151 | Single 10/10; nested 7/10 booted within 3 seconds |
| Same static shell, sandboxed process isolation disabled diagnostically | Single 10/10; nested 10/10 booted |
| Restored default isolation, recording CDP targets after failure | Single 10/10; nested 4/10 booted within 3 seconds |
| Full ocean, ephemeral Playwright 1.63.0 / Chromium 153 | Both nested cold samples failed the 5-second rendering gate; upgrading alone did not resolve the fixture failure |

Earlier full-workload failures also persisted through 60-second waits. The new static test checks the first bootstrap console marker, before author execution; it is not a rendering benchmark. A failing frame has no observed author bootstrap and only two Playwright frames instead of three. CDP target snapshots do not establish whether the inner frame has its own process or is paused; do not infer either from target count alone.

The process-isolation experiment is a lead, not causal proof. It changes scheduling/process allocation, and the sample is small. Never ship the diagnostic flag or relax sandbox/CSP to obtain a green gate.

## Reproduce

From the repository root:

```sh
node scripts/planning/srcdoc-startup-reduction.mjs --headed
node scripts/planning/srcdoc-startup-reduction.mjs --headed --grid --header
node scripts/planning/ocean-startup-reduction.mjs CAPTURE_JSON --static-author
node scripts/planning/ocean-startup-reduction.mjs CAPTURE_JSON --static-author --diagnostic-no-isolation
```

`CAPTURE_JSON` is the local BrowserOS capture consumed by the existing ocean probe, not a checked-in author script. This dependency means the ocean reduction is not yet a self-contained upstream bug reproducer. The fully reduced probe is self-contained but currently passes.

Local raw output: `/tmp/afbin-reduction-151.json`, `/tmp/afbin-reduction-grid-151.json`, `/tmp/afbin-ocean-static-reduction.json`, `/tmp/afbin-ocean-static-no-isolation.json`, `/tmp/afbin-ocean-static-targets.json`, `/tmp/afbin-ocean-current-153.json`. These temporary files are not durable CI artifacts.

## Published state

Searches of Chromium reports, Playwright issues and release notes found no confirmed matching published bug. This is not proof that no report exists.

- [Chromium upstream sandboxed srcdoc tests](https://chromium.googlesource.com/chromium/src/+/HEAD/content/browser/site_per_process_oopsif_browsertest.cc) explicitly exercise srcdoc with sandboxed-frame isolation enabled and disabled.
- [Playwright 1.63.0](https://github.com/microsoft/playwright/releases/tag/v1.63.0) is the current release tested separately without changing repository dependencies.
- [Extension injection regression](https://groups.google.com/a/chromium.org/g/chromium-extensions/c/C-zuSDGoJWk/m/hBlNJYPRAQAJ) involves sandboxed srcdoc and process isolation, but extension injection is a different failure path; not evidence that our issue is the same bug.
- [Playwright cross-frame Promise issue](https://github.com/microsoft/playwright/issues/41826) concerns collected promises, not a proven match for missing startup.

## Remaining work

Implement the managed runtime and use parent-visible capability messages for startup and outcome checks. Earlier ocean-workload-perf.mjs child-frame inspection remains unsuitable as a Chromium startup oracle; its failure must not be relabeled as a production execution failure. No architecture switch or security relaxation is justified.
