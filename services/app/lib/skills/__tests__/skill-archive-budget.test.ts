/**
 * The downloadable skill ZIP stays within its size budget. Its own file, importing only the skills module, so the
 * `pr fast` guard tier (scripts/ci/guard-tests.json) checks every pull request against the archive the platform serves:
 * #1014 grew the archive past the budget and only main's full node suite noticed.
 */
import {describe,expect,it} from 'vitest';
import {archiveFor} from '@/lib/skills';

// 1.6 MiB: the data-driven examples, their steps files and the generator are worth more to agents than the bytes.
// 1.65 MiB since #1014: local preview bundles the generated Hasura dataset API (preview-datasets.mjs, ~25 KB).
// 1.67 MiB: the shared sign-up list starter (examples/shared-list*, ~19 KB) took the sign-up task from 118-364 s to 42 s.
// 1.68 MiB: main sat 155 bytes under 1.67; local preview's `_sql` (node:sqlite, ~2.3 KB) replaces GraphQL aggregation.
// 1.70 MiB: main sat 6.7 KB under 1.68; the API dashboard starter (examples/api-dashboard*, its new-app helper; ~21 KB
// net) lets one command answer "a dashboard of an API behind a key, with shared notes", built from scratch in 340-511 s.
// 1.73 MiB: the codebase report (examples/codebase-report*, new-codebase-report.mjs and its git gatherer, ~28 KB
// stored) is the report-from-data starter for agents working inside a repository: an agent asked to report on
// a codebase published it in 142 s, 31 turns. The shared-app/shared-list removal frees more than that.
// 1.75 MiB: main sat under 1 KB below 1.73; the deep CSV dashboard (~17 KB stored: its renderer
// examples/csv-dashboard.mjs with linked _sql filters, a map, a heatmap and small multiples, its steps' linked-filter
// check and the gen-deliveries.mjs generator in place of repairs.csv) is where every CSV page starts; the dashboard
// eval passed 3/3 with it as on main. The shared-app/shared-list removal also covers this.
// 1.74 MiB: the tracker (examples/tracker*: one template new-app trims by features, its checks and limits resolver)
// replaced shared-app (with budget.ts) and shared-list, leaving the archive at 1,817,470 bytes (1.733 MiB);
// the cap comes back down to what that needs, with the usual few KB of headroom.
// 1.75 MiB: main sat 0.5 KB under 1.74; agent session names (scripts/toolbox-agent.mjs, ~6 KB) give every agent
// comment its own name ("Claude Code Red") and keep two agents sharing one sign-in from hiding each other's comments.
// 1.76 MiB: the SQL model (scripts/sql.mjs, schema and statements through the page SQL door, ~6 KB) replaces
// graphql.mjs as the way agents read a page's tables; graphql.mjs stays for older pages, so the archive grows by it.
// 1.77 MiB: main sat 1 KB under 1.76; the events watch (scripts/events.mjs and its loop toolbox-events.mjs, ~9 KB net
// of the comment watch it replaces) is one watch over GET /api/events for every page and a group's job runs, and
// comment.mjs watch is now its comments alias.
const SKILL_ARCHIVE_MAX_BYTES=1.77*1024*1024;

describe('the downloadable author skill archive',()=>{
 it('fits its size budget',async()=>{
  const {bytes}=await archiveFor('https://example.test');
  process.stdout.write(`Stored native skill ZIP bytes: ${bytes.byteLength}\n`);
  expect(bytes.byteLength).toBeLessThan(SKILL_ARCHIVE_MAX_BYTES);
 });
});
