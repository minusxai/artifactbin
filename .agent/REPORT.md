# w2-kit-data handoff

Branch: `split-p2-w2-kit-data`. Local commits only; no push, PR, or merge.

## Changed files

- `services/app/lib/islands/kit/data.tsx` — React-shaped Select, measured virtual DataTable, remote sort/page reads, rich cells, Question loader TODO.
- `services/app/lib/islands/__tests__/kit-parity.ts` — optional table/scalar data mounts today's React runtime components for parity while preserving existing calls.
- `services/app/lib/islands/__tests__/kit-data.test.tsx` — parity seeds with shared data, corrected Select listbox expectation, table and Question behavior tests.
- The preceding local commit `ad37d048` contains the original kit, recipes, and shared question envelope.

## Evidence

| Requirement | Observed evidence |
| --- | --- |
| Number, Select, DataTable parity | Three original parity seeds passed using the same `monthly`/`regions` tables and `region` scalar on both sides. The sole seed correction replaces native-select interaction with today's button/listbox shape. |
| Select write | Listbox options `All regions`, `East`, `West`; choosing East calls `setValue('region', 'East', undefined)`. |
| DataTable | Tests cover measured virtual window above 50 rows, local ascending/descending sort, remote sorted replacement and append paging, image copy, timestamp, authored template, and visible/unknown user cells. |
| Question | Injected loader stays idle at boot; pointer interaction and a distinct table snapshot change each trigger one load in their respective tests. Default runtime loader has a marked TODO pending `ctx.loadChart`/`lib/islands/chart.ts`. |
| Checks | `npm test -- --files services/app/lib/islands/__tests__/kit-data.test.tsx services/app/lib/islands/__tests__/context.test.tsx`: 2 files, 16 tests passed. `npm run validate`: passed. `git diff --check`: passed. |
| Size | Generated `/islands/kit-data-fa7d05fde8a0c514.js`: 53,924 raw bytes, 17,174 bytes Brotli. |

Initial parity-adapter red: 3 failures (Number id, Select native tag, DataTable style serialization). A later virtual-window assertion exposed zero visible rows before the first observer rect; the fallback window now keeps rows visible. After the final code and test edits, the focused suite and validation passed. No browser gate ran in this Sol worktree; the orchestrator owns container gates and CI.

## Integration requirements and contract requests

- Runtime track: wire `Question`'s default lazy loader through `ctx.loadChart` or `lib/islands/chart.ts` when that API lands. The injected loader is already exercised.
- Run the compiled parity/browser gate in CI or the orchestrator's container runner, including open Select and a browser-measured long DataTable. jsdom tests establish the focused behavior, not a full browser gate.
- No contract signature change requested.

===CONCISE===
The three parity seeds pass with shared React/Solid data.
DataTable has measured virtualization, rich cells, and remote sorting/paging.
Question loads after interaction or a post-boot table update through its injected loader.
Focused tests passed 16/16; validation passed; no browser gate ran.
The data chunk is 17,174 bytes Brotli; default chart wiring awaits the runtime API.
