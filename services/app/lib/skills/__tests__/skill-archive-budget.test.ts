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
// 1.77 MiB: main sat 16 bytes under 1.76; a page's linked files now publish with it (<a href>, and the refusals that say
// what to write for an unlinked or unsupported file) beside the reply-before-watch guidance for several pages (~1 KB).
// 1.78 MiB: main sat 217 bytes under 1.77 once the tracker's limit held for moves (its save function and checks);
// exporting one chart or section of a page (export.mjs --element, its limits and refusals) needs about 1 KB more.
// 1.58 MiB: GraphQL is deprecated, so the skill carries nothing for it: graphql.mjs, toolbox-graphql.mjs, the bundled
// graphql library and the local GraphQL dataset preview (preview-datasets.mjs, its sessions and routes) went, leaving
// the archive at 1,650,778 bytes (1.574 MiB, down from 1,859,312); the cap keeps the usual few KB of headroom.
// 1.579 MiB: the unused and retired paths left the scripts (serve --runtime-dir among them), leaving 1,651,541 bytes.
// 1.577 MiB: comment watch --once, --cursor and --append went, leaving 1,650,146 bytes.
// 1.586 MiB: this branch adds the events watch (scripts/events.mjs, toolbox-events.mjs) and service sign-in (auth.mjs --audience).
// 1.587 MiB: the service-token exchange (scripts/toolbox-service-token.mjs) lets one saved grant reach a co-hosted service, leaving 1,663,203 bytes.
// 1.593 MiB: the page-apps guide (routes in `$` values, seat(), confirmations, external APIs) and root-relative files in
// publish, on top of the service-token helper, leaving 1,669,373 bytes.
// 1.534 MiB: page functions left the skill (functions.md, resolvers/, the tracker's tracker.ts and the API dashboard
// starter), the default connection and the group address approvals joined it, leaving 1,608,368 bytes.
// 1.562 MiB: af-markdown-editor (a rich text field whose value is Markdown; its readable contract, schema, typing
// rules and styles, ~23 KB stored) gives pages a Markdown field to write in, leaving 1,634,061 bytes.
// 1.598 MiB: af-chart (one analytical chart over SQL, a linked dataset or rows; its readable contract, data sources,
// frame, model, renderer and styles, ~36 KB stored) is how every page draws a chart, and sql.mjs --chart
// (toolbox-chart.mjs) shows an agent that chart before publishing, leaving 1,675,360 bytes.
// 1.618 MiB: Graphite (design-systems/graphite.css, ~17 KB stored), a quiet analytical system of grey and ink chrome
// with flat colour only for data, gives analytics apps and internal tools a fitting look, leaving 1,693,053 bytes.
// 1.619 MiB: scripts/toolbox-limits.mjs ships the server's size limits (the service payload and what a page may
// bundle), so commands and sandboxes refuse what the server would, leaving 1,696,984 bytes.
// 1.624 MiB: af-chart and af-data-table label where their rows came from (Live, Live · paused, Snapshot; the readable
// data-source-label.ts and its wiring, ~4 KB stored), leaving 1,701,843 bytes.
// 1.628 MiB: af-data-table reads a declarative sql attribute through the page SQL plumbing it shares with af-chart
// (the readable page-sql.ts and data-table-sql.ts, ~3 KB stored), and the codebase report lists its chart values with
// it instead of hand-built tables, leaving 1,705,609 bytes.
// 1.629 MiB: main sat 118 bytes under 1.628 (1,706,963); approved queries (groups.mjs queries, approve and unapprove,
// and the data guide's pointer to them, ~0.9 KB stored) let a group's Admin show a page's default-connection query to
// every reader, leaving 1,707,861 bytes.
// 1.630 MiB: main sat 269 bytes under 1.629; af-data-table measures its columns again when a sort mark, a font
// swapping in or being shown after a hidden draw would clip a header (the readable data-table-measure.ts, ~0.7 KB
// stored), leaving 1,708,556 bytes.
// 1.631 MiB: main sat ~40 bytes under 1.630; bundling (publish and check --draft) refuses hidden files and a home or root
// folder, so a hostile page cannot name ~/.aws/credentials into an upload, leaving 1,709,439 bytes.
// 1.632 MiB: main sat 39 bytes under 1.631; group publishing and folder creation leave the role decision to the
// server and say its refusal plainly (groupRefusal), in place of the client's check for the retired Editor role,
// leaving 1,710,432 bytes.
const SKILL_ARCHIVE_MAX_BYTES=1.632*1024*1024;

describe('the downloadable author skill archive',()=>{
 it('fits its size budget',async()=>{
  const {bytes}=await archiveFor('https://example.test');
  process.stdout.write(`Stored native skill ZIP bytes: ${bytes.byteLength}\n`);
  expect(bytes.byteLength).toBeLessThan(SKILL_ARCHIVE_MAX_BYTES);
 });
});
