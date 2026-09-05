# Node identity planning evidence — 5 September 2026

Scope: planning experiments, not a production implementation. Checkout 35f3074.
Canonical plan: https://artifactbin.dev/a/Qud0y1

## Reproduce

- `npx vitest run --project=node services/app/lib/story/__tests__/node-id-planning.test.ts --reporter=verbose`: 11 passing tests, including four captured model-generated edits through the actual splice kernel.
- `node scripts/planning-node-transactions.mjs`: five passing Postgres rehearsals. Requires the dedicated container `artifactbin-node-planning-pg`, created with `docker run --detach --name artifactbin-node-planning-pg --env POSTGRES_PASSWORD=planning-only --publish 127.0.0.1::5432 postgres:17-alpine`. Only prototype tables in this disposable container are modified. Uses two independent psql connections and waits for a confirmed lock-holder barrier.
- `npm run validate`: type/residual-name checks passed.

## Postgres observations

Deletion-first: comment's locked read sees removal; no relation inserted.
Comment-first: relation commits; later removal leaves an orphan.
Migration: injected division-by-zero after source/archive writes rolls back all changes. Retrying twice produces one archive and one version increment, with migrated relation key.
Historical-source prototype: normalizing the old alias preserves authored id and the migrated relation.
Reservation: a unique (artifact_id,node_id) ledger rejects retired ids for the same artifact and permits the same id in a different artifact.
Container restarted and the rehearsal rerun successfully. This is not proof of deploying/rolling back a future application binary.

## Real browser and existing API

BrowserOS neo, local running deployment on port 5000; its container image is not asserted to equal the source checkout.
Disposable document VwN6mK: Tabs ids survive switching panes. Popover trigger/content/text ids survive opening; context-only Popover root has no DOM box. Hydrated Number, DataTable and Question render data but drop authored ids. Source inspection corroborates adapter gaps in StoryRuntimeApp.tsx.

Disposable document pwTHPz: create pre-id source, replace with authored id, revert original version. Actual revert returns `<p>Before IDs</p>`: normalization is missing today. Replacing with normalized markup then editing by id succeeds.
Two sibling edits from the same base edit_id both return 200. Final source contains both `aaaa: done` and `bbbb: blocked`.

Blank-page DOM prototype in real browser: preview IDs initially steal global getElementById. Prefixing preview IDs and rewriting local `for`, fragment `href` and SVG `url(#...)` references yields zero duplicate IDs, correct preview label control and SVG reference, and a main-document `:target`. Production transformation must also handle all supported IDREF/token-list/CSS forms; this probe is not an exhaustive sanitizer.

## OpenCode GLM-5.3

Harness: opencode 1.18.23, `run --pure --format json --model fireworks-ai/accounts/fireworks/models/glm-5p3`, existing Fireworks credential passed via environment. No credentials included here.
Two requests, no retries. Prompts explicitly request exact-once old_string/new_string JSON, smallest unique context, preserved IDs, no tools/files.
First: change only second repeated `active` label to blocked. Returned `id="bbbb">active` → `id="bbbb">blocked`.
Second: delete bbbb, insert after bbbb, move cccc before aaaa in three identical list items. All three outputs valid. Captured exact edits are in node-id-planning.test.ts and execute through the existing kernel.
Reported costs: 0.02860868 + 0.0355486 USD. Four edit cases passed; move quotes the sibling region, so it has the expected broad conflict footprint.
This is model-generated edit validation, not autonomous MCP task completion or a head-to-head structural-tool benchmark. The agreed V1 has no structural edit API; such a benchmark is not a prerequisite for this plan.

## Implementation acceptance (not claimed complete)

Production routes must integrate the reservation ledger/alias mapping, versioned backfill, normalizing revert, relation-only comment actions, adapter forwarding and preview namespace transformation. Test actual archives/events/ACL and rollout/rollback using the future compatibility build. Old pre-compatibility binaries are not valid rollback targets after migration. Apply every prototype's cases to integrated routes before release.

The files node-ids.ts and node-ids.acceptance.ts in this directory are older UNIMPLEMENTED contract sketches. They are kept outside production and automatic test discovery; their assumptions are superseded by the canonical plan. They are not passing tests or completed feature code.
