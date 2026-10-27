# Migration batch host

A small POSIX/Python 3.11+ host wrapper around the existing migration commands.
It does not convert documents, decide visual acceptance, mint credentials, relax
the latest-only plan, or replace normal import/readback validation.

Keep the database, manifests, grants, logs, evidence and approval files **private**.
One shared SQLite database coordinates all three owners. A different database is
a different lock domain: never give independent databases live resource grants.
The coordinator must reserve each slot with existing manual owners before issuing
a grant. Migrating the lease ledger is explicit; an empty database or `ps` output
does not authorize a browser or production job.

## Normal operation

Create one immutable `migration-batch-job-v1` manifest per artifact/version/input
revision (see `contract.py`). Its plan must contain exactly393 latest heads and
the selected source/version. List every approved input/script/config in `inputs`
with an absolute path and SHA256. Each command is an argv array and an explicit
working directory, with no shell interpolation or secrets in arguments. Declare
its immutable output files and meaningful JSON assertions; the wrapper seals their
actual bytes. Outputs that subsequent tools mutate must not be sealed prematurely.
Keep normal source freshness, absence, dryrun, current-reader guard, onceapply,
full preservation readback and live token revocation commands unchanged.

Typical ordered stages: recover/hash → assemble → fixture/context/disposable →
source-bound probe → source/native/regression camera pair → compare/closure/dryrun
→ independent final review → immediate freshness/absence → onceapply → full reader
and token revocation → completion recorder. A retained already-approved stage may
be verified read-only rather than captured or imported again. This is reuse of
exact evidence, not acceptance inferred from file existence or an old count.

```sh
python3 scripts/migration_batch/runner.py enroll --db /private/batch/state.db --manifest /private/job.json
python3 scripts/migration_batch/runner.py watch --db /private/batch/state.db --job job-id
python3 scripts/migration_batch/runner.py status --db /private/batch/state.db --job job-id
python3 scripts/migration_batch/runner.py batch --db /private/batch/state.db --owner owner-id
```

`watch` advances through ordinary steps automatically and stops at an exception,
review or lease boundary. Commands execute in detached stage workers: closing the
watcher or losing its network connection does not kill or relaunch them. Restart
the same command to resume. Concurrent watchers cannot launch the same step twice.
`batch` advances all enrolled jobs belonging to one disjoint owner, allowing other
owners to run against the same database concurrently. It stops once that owner's
jobs are complete or waiting. Exceptions return exit2 and remain visible through
`status`; one failed job does not cancel another owner's progress.

At `waiting_review`, the runner emits a packet containing the exact job hash and
all predecessor output hashes. The independent reviewer writes a
`migration-batch-review-v1` file binding that packet, job and review step. An
already approved external head/closure remains a mandatory hash-bound `approval`
reference on each production-write step; the existing importer checks its own
authority and acceptance contracts too. Review the machinery once, then review
each artifact's actual acceptance packet, rather than reapproving unchanged tools.

```sh
python3 scripts/migration_batch/runner.py approve --db /private/batch/state.db --job job-id --file /private/review.json --sha256 REVIEW_SHA
python3 scripts/migration_batch/runner.py grant --db /private/batch/state.db --file /private/grant.json --sha256 GRANT_SHA
python3 scripts/migration_batch/runner.py watch --db /private/batch/state.db --job job-id
```

Only an explicit `migration-batch-grant-v1` coordinator grant can reserve
`browser-1`, `browser-2` or `writer`. It binds the exact owner/job hash/step and an
expiry for **starting**, not stealing, a reservation. A successful browser step
releases its slot. The writer remains held through every preservation/readback/
completion step and releases only when the whole job completes. Record the return
to the coordinator's existing ledger; never silently unlock another owner's job.

The supplied `completion.py` retains normal v2 full-reader, ACL/comments,
revocation, strict-versus-practical comparison and predecessor-chain checks. It
creates an immutable count receipt, then atomically promotes `ACTIVE` aliases.
If interrupted between those operations, invoking the exact same request validates
and reuses that receipt. It neither imports again nor increments twice. A newer
verified receipt chain is preserved; it never downgrades an advanced count.

```sh
python3 scripts/migration_batch/completion.py --request /private/completion-request.json --output /private/completion-result.json
```

## Exceptions and recovery

Changed source/config/code/approval or sealed evidence: stop and create a newly
bound manifest/evidence revision. Never edit an enrolled manifest to make it pass.

Only explicitly listed transient exit codes on `read` commands can retry, at most
three attempts. Commands must themselves support those retries. Browser and
production writes never automatically retry. Every attempt keeps a separate log.

An interrupted or failed write, dead worker, failed browser command, or malformed
receipt enters the exception queue. Live/uncertain resource reservations remain
held. Reconcile the existing process/container and target state read-only, using
the normal importer receipts/full reader/token cleanup. The coordinator and
independent reviewer decide the exact recovery; do not delete SQLite rows or run
the write again merely because the controller lost contact. A worker lost before
its PID was saved is also uncertain, not an invitation to relaunch.

Manual exceptions remain: unsupported source behavior or conversion fixes,
practical visual/functional judgment, source drift, credentials/provider failures,
uncertain production outcomes, and coordinator coexistence with legacy jobs.
This wrapper removes ordinary command invocations/status handoffs; it does not
replace those decisions.

Run host behavior tests with `python3 -m unittest discover -s tests/migration_batch -v`.

Conversion batches use `conversion.py` with a private, hash-bound configuration
matching `conversion_contract.py`. It accepts up to 100 unique reserved latest
heads and skips accepted IDs proved by an immutable predecessor chain. A trusted
local adapter runs existing snapshot/preparation/converter APIs and emits one
review packet per head. Supported local assemblies and explicit unsupported
patterns remain separate from final artifact acceptance. This command grants no
browser or production lease.

Run `python3 scripts/migration_batch/conversion.py --config CONFIG --sha256 SHA
--root OUTPUT --db SHARED_DB`. Restart that exact invocation after a controller
failure: existing detached workers and sealed outputs are reused. Two local
conversion workers run at a time; the shared database controller lock prevents
another batch controller or generation from duplicating an active conversion.
The normal browser/writer resource gates remain separate. A shared converter fix
uses a new adapter hash and new output directories, then `--only ID ...` reruns
only affected heads. Earlier outputs remain immutable and the summary retains
untouched heads. Exceptions are grouped by code in `summary.json`.

The adapter must bind the current source row, document, identity, referenced
resource versions/policies/object bytes and producer/component revisions; missing
or changed input is an exception. Snapshot reuse is valid only for its recorded
read time. Recheck current source heads immediately before an import. Never use
an old archive as a substitute for a changed latest head.

Before future once-apply manifests, run `preflight.py --config READER_CLI_CONFIG`
as a read stage. The normal preservation reader requires the CLI config with
`receiptRoot`, `batchPath`, `planPath`, and `outputDirectory`; a pipeline context
is not that contract. The live pilot caught this argument error after its one
successful apply. An independently reviewed read-only recovery completed the
full reader and count without applying again. `reconcile.py` permits exact,
independently bound adoption of completed **read** outputs only; it cannot adopt
an uncertain write or execute a command. Preserve the original failure and its
reviewed recovery.

The reader expected-map check has two lifecycle phases. Before apply, run
`reader-preflight.mjs` with `--phase before-apply`, the exact CLI config, source
ID, actual scope module and its digest module. It derives version, assembly,
comparison and optional decision pins from sealed inputs and compares the
scope module's exported map. Target head/publication receipts are not required
or fabricated at this phase. After apply, run the same command with
`--phase after-apply-before-reader-db`; it invokes the actual `readbackScope`
against the real receipts before the DB reader or token mint starts. Bind both
modules and all inputs by hash in the tail job. This prevents stale copied
expected maps without weakening the normal preservation reader.

The latest-selection helper creates an immutable alternate plan and selection for the same agreed ID set when a verified current source version advances. It preserves old plan rows and receipt metadata in provenance, requires mapped source identity and a read-only current-row proof, rejects history and rollback, and updates changed receipts to one current revision with no archived rows. It grants no import authority.

## Functional smoke

`smoke.mjs` replaces per-batch private literal probes. It checks what a reader relies
on, on both implementations, keyed by authored `id` (both readers render it; never
`data-af-id` on the original): literal text exactly, dynamic text equal across sides,
`Cell`/`Chart`/`DataTable`/`Mermaid` loaded with equal values, mark counts and headers,
and controls present and labelled. Pages with data, layout components, loops and
conditions are in scope. Only binding defects refuse: packet/result/source digests,
duplicate ids, or a data component or control without an id.

```sh
node scripts/migration_batch/smoke.mjs prepare --packet REVIEW_PACKET --sha256 SHA --output NEW_DIR
node scripts/migration_batch/smoke.mjs compare --contract NEW_DIR/contract.json --source SOURCE_OUT --target TARGET_OUT --output RESULT
```

`prepare` is a `read` step: it writes `contract.json`, a self-contained `probe.mjs` for the
existing `mountImportedPilot` camera hook, and `provenance.json`. Put the same probe in the
source and target capture bundles. The probe waits until every present data component is
loaded and idle (not merely `aria-busy="false"`: served cells start idle with a placeholder)
and two observations agree, then writes `smoke-<side>-<state>-<viewport>-<normal|regression>.json`.
An unsettled page is recorded, not thrown, so screenshots still complete.

`compare` exits 0 `pass`, 1 `fail` (the converted page is wrong: missing or pending data,
changed text or values, missing controls) or 2 `exception` (the original did not render
that data or text, so nothing was proved). Warnings — visibility, virtualized row counts,
chart mark labels, layout-only ids — go to the reviewer. Mutations, author scripts and
control behavior are listed under `notExercised`; this initial-state smoke does not accept
them. Screenshots, practical readability and final review remain required.
