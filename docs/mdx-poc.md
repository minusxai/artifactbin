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

## Remaining implementation review

Finish browser resize/float and independent-editor checks; integrate canonical document navigation with artifact links; verify shared component/dataflow behavior and source import limits; expand semantic edge cases; refactor view/layout boundaries; inspect CI. This is not yet a completed POC.
