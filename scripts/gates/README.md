# Browser gates

The native HTML reader retains the reader, comments, sharing, media, export,
offline, data and origin-isolation journeys. The former editor-engine,
editor-path, editor-exits, inplace-edit and viz-editor gates exercised the
removed JSX source editor and compiler editing protocol. The sessions gate
exercised the removed CLI browser sessions and test-user commands. The
mermaid-prerender gate exercised server harvesting of compiled JSX diagrams;
native HTML authors provide their own markup and scripts. Those gate files
and manifest rows are retired together rather than enrolled as skipped checks.

The native data gates retain the platform seams with author-owned HTML:

- `live`: independent readers, same- and different-page dataset invalidation,
  original sharing controls, explicit viewer insert policies and revocation,
  isolated origins, private Apollo state and complete HTML replacement.
- `data-journey`: original dataset catalog and policy editor, typed CSV/nulls,
  full GraphQL pagination, private sharing/revocation, numeric SVG rendering,
  native dialogs, local draft persistence and offline booking interaction.
- `datasets-in-documents`: 500-row editing, typed atomic updates, conflicts
  without retries or lost drafts, original named-user grants, and row images
  with bounded initial image downloads and additional bytes after scrolling.

The former roadmap fixture was an authored JSX business application, not a
platform view or sprint API. Its view/filter authoring is represented by the
installed CSV dashboard example and author trial; shared creation and dialogs
are represented by booking, shared-app author trials and the native data gates.
Those author trials remain separate evidence; a gate pass does not claim them.
Compiled DataTable virtualization, Select portals, generated roadmap components
and island DOM takeover assertions retired with those compiler components.
Native table writes still use the actual GraphQL dataset adapter and original
permissions, never an imitation data service inside a fixture.

The existing `component-baseline` gate also has an explicit private native
migration mode. It produces `native-migration-pilot-capture-v1` evidence, separate
from the public component suite. Without private input it makes no migration
claim. The external manifest contract is
`scripts/lib/native-migration-pilot-contract.ts`: pin both application revisions,
the canonical row/export and recovered source, the complete native bundle, the
complete static harness import closure, and matching retained theme, viewports and interaction states.

Supply absolute private paths through `NATIVE_MIGRATION_PILOT__INPUT`,
`NATIVE_MIGRATION_PILOT__CANONICAL`, `NATIVE_MIGRATION_PILOT__RECOVERY`,
`NATIVE_MIGRATION_PILOT__BUNDLE` and `NATIVE_MIGRATION_PILOT__OUTPUT` when invoking
`node scripts/gate-container.mjs --servers 1 component-baseline`. Inputs mount
read-only; only the explicit private evidence directory mounts writable. Private
page bytes, action labels and screenshot bytes are never printed to gate logs.
Use identical harness files in the pinned original and candidate worktrees and
run each implementation once after FAST checks, at completion of the brief.
Candidate capture also publishes a deliberate CSS regression through the normal
API and requires a real screenshot change. Compare both private capture folders
with `compareNativeMigrationPilot` from `scripts/lib/native-migration-pilot.mjs`;
any pixel, behavior, used-font byte, missing state or regression-control failure
prevents a parity pass. Local publication is disposable test state, not a
migration write or evidence of ownership/access/comment preservation.
