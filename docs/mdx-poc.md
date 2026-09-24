# MDX document POC implementation

## Contract and boundaries

New documents use one normalized JSONB document (`schemaVersion`, `rootId`, `nodes`). MDX is import/export, not executable code. Existing static JSX rendering, component validation, author-script isolation, access control, IDs and typography remain authoritative boundaries.

- `services/contracts/src/document.ts`: browser/server document, primitive, request and result contracts. No service dependencies.
- `lib/document/model.ts`: pure document commands, local inverse/diff and affected-node contracts. Traversal is local to the client/import path; request ancestry is trusted. Full-tree validation is for imports and tests, not database CHECKs or each save.
- `lib/document/sql.ts` + `store.ts`: parameterized native JSONB mutation expressions; one conditional head update plus archive per attempt; fresh-snapshot CAS retry retains original client base. Archives retain prior snapshot, with outgoing change sets. Existing permission predicates and identity ledger are reused.
- `lib/document/mdx.ts`: parse MDX as data and normalize; round-trip node identity/props and reuse JSX interpreter inputs. Reject executable MDX modules.
- `lib/document/editor.ts` + UI: one ProseMirror tree; registered components and container slots, direct editing, formatting, structural commands, resize/float, conflict recovery and undo. Backend canonical state is JSONB.
- HTTP routes translate service results and enforce existing authentication. No domain rules in route handlers.

## Milestones (in dependency order)

1. Shared contracts; schema columns/index and ownership assertions; operation model and SQL tests (red before implementation).
2. Atomic persistence and permission/idempotency/conflict tests, including 23-version lag and rollback.
3. MDX codec and static JSX bridge with identity, rich marks, nested layouts, HTML/iframe round trips and rejection cases.
4. Full inline editor and app integration; source view/import/export; collaboration transport and draft-preserving conflicts.
5. Focused checks, local running-app verification, routine validate/test; on suite deferral push an empty-body PR and inspect CI. No migration/old-document work.

## Evidence and risks

Planning probes proved native nested JSONB operations, compositional rollback, 23-version checks and two-connection CAS retry for separate version rows. These are not app test evidence. Measured full-document SQL costs rise with document size; batch changes inside owning nodes and use native insert/remove or bounded array replacement. Snapshot writes add cost. Avoid a full growing history array.

High-risk implementation tests: Unicode/IME and mark boundaries; complete old/new ancestry for structural changes; cycles/duplicate identity; retained IDs on split/join/undo; partial batches; permission changes between preparation and commit; duplicate operation IDs; reactive/HTML/iframe trust boundaries; cross-container selection and visual float behavior. MDX metadata attachments must be tested across lists/tables/nesting, not only paragraphs.

## Verification log

- Schema/model: observed missing-column and missing-module failures, then 33 tests passed across model, ownership and generated-schema checks.
- Native SQL compiler: observed missing-module and parameter-binding failures; 13 database tests passed after implementation/fix.
- Store: 11 tests passed, including 23-version lag, snapshot semantics, duplicates, access, atomic refusal and identity retirement/restoration. These use PGLite; real PostgreSQL race verification remains outstanding for the implemented service.
- MDX codec: 11 tests passed after fixing iframe round-trip wrapper handling. Executable MDX and unsafe markup cases are rejected.
- Editor model: 4 tests passed for nested round trips, split/join, history, text-range font and paste IDs.
- Buffered session: 3 tests passed, including in-flight typing, conflict draft preservation and stable retry IDs.
- HTTP: 3 tests passed, including browser session and CSRF checks (observed browser session 401 before fixing the auth adapter).
- UI: 3 tests passed. A real-browser mutation loop was reproduced; the regression test initially hung and was terminated, then passed after moving layout styles off editable child nodes.
- Local browser at port 3030: rendered nested Flex and managed iframe, typed prose, saved a new document, inserted a paragraph with Unicode and reloaded with those changes retained. Disposable account `mxmx_test_mdx_20260924@example.com`, isolated browser context. Further layout/collaboration checks remain.
- `npm run validate` passed. Routine `npm test` deferred 724 files to CI (exit 2): NOT a test pass. Opening a draft PR for CI while finishing integration.

## Integration checkpoint

- Canonical document links now open the inline editor; legacy whole-source edit/revert endpoints refuse these documents. Derived JSX is computed for existing rendering/query consumers, never persisted as another authority.
- Source editing retains matching identities and paragraph styling. Imported empty source gets an editable paragraph. Inline components retain their child content through copy/paste.
- Flex rendering and editor resizing share geometry; width/height, float, row/column direction, range fonts, keyboard sizing, and selected iframe source editing are exposed in the editor. Reactive expressions share one document data store.
- New regressions were observed failing before fixes: source styling, old revert, dataflow expressions, component selection across width edits, buffered edits overlapping a remote change, and oversized SQL offsets.
- Latest focused SQL/model/store/editor/layout run: 55 tests passed. Session: 4 passed. UI: 6 passed in its latest run. Source codec/store checkpoint: 29 passed. These are focused checks, not substitutes for the deferred full suite.
- Two running browser editors submitted edits to different paragraphs from base version 2; both saved and both displayed both edits. Two edits to the same paragraph from base version 4 yielded one save and one preserved conflicting draft.
- Browser width/float controls worked and persisted. The browser tool's drag generated pointer movement but omitted pointer-up; explicitly completing that event verified resize persistence. A complete physical pointer gesture still needs the CI/browser check.
- First PR CI checkpoint passed API/node/UI tests, all six browser-gate shards, build and validation. The job-timing gate failed because node shard 1 exceeded 240 seconds by six seconds. Later changes require fresh CI.
- Added a CI-only real-PostgreSQL service proof that holds a row lock until independent service connections wait, then checks CAS retries, overlapping edits, duplicate requests and trash races. It has not been run locally (CI-only repository rule).

Remaining verification: final CI, source/formatting/resize smoke checks on the latest build, and retry recovery. POC limits: collaboration uses polling and node-level conflict refusal, with no character-level merge or presence. Arbitrary author-script and referenced-artifact editor parity are not established by these checks.

## Resize and drag UX revision

The divider lives in the actual gutter between adjacent children. It previews and commits their shared proportions; the parent's outer width/height handles resize the whole container. Width is displayed as a percentage of the immediate parent (Flex children use their parent's shares); height remains pixels for normal flow. Numeric input retains partial digits while typing. Resize/float controls appear only for a selected layout or component, in a fixed-height toolbar row so selecting a drag handle cannot move the canvas under the pointer.

Observed browser checks: 35% changed the selected child; 85% changed its whole parent without changing child proportions. First-gesture component movement into a column now works after removing canceled native mousedown events and toolbar layout shift. Width/float, font range, saved reload, separate-node concurrent edits, overlapping draft preservation and an interrupted-save retry were also checked locally.

CI's real PostgreSQL service proof passed: independent concurrent updates, overlaps, duplicate requests and a trash race. Its initial fixture mistakenly retained archived rows between scenarios; fixing fixture cleanup made the proof pass. Full CI then passed all API/node/UI suites and build, with the newly added first-gesture drag gate exposing the toolbar shift above. The final revision is pushed for that check; consult PR #77 for the current result.

The POC is available at `/documents/new`. Existing documents are not migrated. Collaboration uses two-second polling and node-level conflict refusal, without character-level merge or presence; unsaved/conflicting drafts are retained in the open editor and can be exported or saved as a new document. Full author-script and referenced-artifact editor parity are outside the demonstrated surface.
