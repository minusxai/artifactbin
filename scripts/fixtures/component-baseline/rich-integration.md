# Rich actual-reader fixture integration

`rich.mjs` adds eleven public families, eighteen state cases and 72 captures per implementation across the existing theme/viewport matrix. These are fixture preparations, not completed comparison evidence. Source provenance is pinned to `8eaac63810b66eb575b018be89bb63443e1b7aaf` and recorded on every pair. No original rendering, CSS, account record or browser screenshot is manufactured.

The root-owned fixture index can append the array:

```js
import { richBrowserParityFixtures } from './rich.mjs';
// ...existing fixtures, ...richBrowserParityFixtures
```

The registration-name resolver must special-case `deck-gl` as `DeckGL`; mechanical PascalCase gives `DeckGl`, which is not an exported API. `slide-deck` correctly resolves to `SlideDeck` and registers both `af-slide-deck` and `af-slide`.

Before capture, the root mount-ready hook must wait for the implementation-specific real engine predicate:

```js
import { richBaselineReadiness } from './fixtures/component-baseline/rich.mjs';
const engineReady = richBaselineReadiness[fixture.id]?.[implementation];
if (engineReady) await frame.waitForFunction(engineReady, undefined, { timeout: 30_000 });
```

Use a Chromium configuration with functioning WebGL2 on both isolated revisions. No missing-GPU stand-in counts as a map capture. Mermaid must decode its actual engine image; capture of “Rendering diagram…” does not cover the diagram. Keep fonts and animation settling from the existing harness. After opening DatePicker, wait for the real calendar's `button[aria-label="2024-06-16"]` before snapshot or selection, because the original loads its calendar lazily. The action's empty accessible name intentionally targets the only initial button: old and new trigger names differ and both original names must be retained in evidence.

The candidate-only assertion layer needs required facts for these new IDs; its current six-family switch does not establish their success merely by finding no page errors. Useful facts include the rendered Markdown heading/table/highlight, decoded Mermaid image, Isometric keyed geometry, live map canvas and reset controls, both slide headings, User fallback `Unassigned`, avatar fallback initials/count, actual named icon paths, each progress value/state, selected ISO date/calendar and focused Tooltip content. Include progressbar/img/tooltip semantics if comparing those attributes; the current `browserState` selector omits them.

The per-pair `limitations` list is part of the fixture hash. Preserve it in capture/report output. In particular, do not conceal the native map control/legend differences, HTML Mermaid caption, DatePicker accessible-name changes or the different ownership of slide chrome. User covers the exact no-person fallback; real person-card identity comparison requires equivalent seeded identities on both services. Avatar covers network-free fallback/group states, not an absent paired image backend. Error/recovery, dynamic theme changes, virtualization and teardown have separate candidate behavioral checks; this module does not label those old/new parity.

Gates are SLOW-tier: an implementer runs them ONCE at the end of the brief, NEVER per edit. The orchestrator runs the combined original/candidate gates; this fixture workstream does not launch another container.
