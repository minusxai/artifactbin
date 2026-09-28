# w2-kit-data handoff

Branch: `split-p2-w2-kit-data`. Local commits only; no push, PR, or merge.
Runtime follow-up commit: `Wire Question to lazy island chart runtime` (single-line subject).

## Changed files

- `services/app/lib/islands/kit/data.tsx` — React-shaped Select, measured virtual DataTable, remote sort/page reads, rich cells, Question uses the runtime chart loader by default and destroys the chart on disposal.
- `services/app/lib/viz/chart-envelope.ts` — constructs the runtime's exact `VizEnvelope` shape for native and recipe charts.
- `services/app/lib/islands/__tests__/kit-parity.ts` — optional table/scalar data mounts today's React runtime components for parity while preserving existing calls.
- `services/app/lib/islands/__tests__/kit-data.test.tsx` — parity seeds with shared data, corrected Select listbox expectation, table and Question behavior tests.
- The preceding local commit `ad37d048` contains the original kit, recipes, and shared question envelope.

## Evidence

| Requirement | Observed evidence |
| --- | --- |
| Number, Select, DataTable parity | Three original parity seeds passed using the same `monthly`/`regions` tables and `region` scalar on both sides. The sole seed correction replaces native-select interaction with today's button/listbox shape. |
| Select write | Listbox options `All regions`, `East`, `West`; choosing East calls `setValue('region', 'East', undefined)`. |
| DataTable | Tests cover measured virtual window above 50 rows, local ascending/descending sort, remote sorted replacement and append paging, image copy, timestamp, authored template, and visible/unknown user cells. |
| Question | Injected loader stays idle at boot; pointer interaction and a distinct table snapshot change each trigger one load in their respective tests. A new default-loader test keeps `ctx.loadChart` idle at boot, loads after interaction with the exact envelope, and observes `destroy()` on disposal. |
| Checks | Focused `npm test -- --files services/app/lib/islands/__tests__/kit-data.test.tsx services/app/lib/islands/__tests__/context.test.tsx`: 2 files, 17 tests passed. `npm run validate`: passed after removing an unused import. `git diff --check`: passed. Broad `npm test` deferred with exit 2 because 345 test files exceed the 50-file local budget; it ran no suite. |
| Size | Generated `/islands/kit-data-fa7d05fde8a0c514.js`: 53,924 raw bytes, 17,174 bytes Brotli. |

Initial parity-adapter red: 3 failures (Number id, Select native tag, DataTable style serialization). A later virtual-window assertion exposed zero visible rows before the first observer rect; the fallback window now keeps rows visible. For the runtime follow-up, the new default-loader test failed 1 of 17 tests because `ctx.loadChart` had zero calls; after implementation, the focused suite passed 17 of 17. The first validation found one unused import and passed after its removal. No browser gate ran in this Sol worktree; the orchestrator owns container gates and CI.

## Integration requirements and contract requests

- Runtime chart integration is complete against `IslandContext.loadChart`, `IslandChartModule`, and `IslandChart.destroy` from PR #148. The injected loader remains exercised.
- Run the compiled parity/browser gate in CI or the orchestrator's container runner, including open Select and a browser-measured long DataTable. jsdom tests establish the focused behavior, not a full browser gate.
- No contract signature change requested.

===CONCISE===
The three parity seeds pass with shared React/Solid data.
DataTable has measured virtualization, rich cells, and remote sorting/paging.
Question defaults to `ctx.loadChart`, remains lazy, and destroys its chart on disposal.
Focused tests passed 17/17; validation passed; broad local tests deferred at 345 files.
The prior data chunk was 17,174 bytes Brotli; no browser gate ran.
