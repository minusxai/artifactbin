# The events service contract

The log of what happened, one service owning it in a schema of its own. `@artifactbin/contracts` `EventsService` is the interface; this file is the wire.

| Method | Route | Body | Answer |
|---|---|---|---|
| `emit` | `POST /emit` | `EventEnvelope[]` | `{ accepted: number }` — envelopes received; storage is `ON CONFLICT (id) DO NOTHING`, so a replayed envelope is harmless |
| — | `GET /health` | — | `200 {"ok":true}` — the Docker HEALTHCHECK and the compose `depends_on` condition; the one GET, every other route POST-only |

One row is a SENTENCE — `subject_kind`/`subject_id`, `verb`, `object_kind`/`object_id` — plus `id` (the emitter's
uuid, and the dedupe key), `at`, `source` and `payload`. The catalogue of verbs per object kind lives in
`@artifactbin/contracts` (`EVENT_VERBS`); the derived name a forwarding rule matches on is `object_kind.verb`
(`eventName`), never a stored column.

One thing about the ARTIFACT vocabulary an operator with a sink has to know: `deleted` means ERASED FOR GOOD and
is said by the purge alone, one per row it swept. A person deleting something says `trashed` (`{format, subtree}` —
the descendants that went with it, 0 for a document); taking it back says `restored` (`{landed_at_root}`, because a
row whose folder is still in the trash comes back at the root); and filing it somewhere says `moved`
(`{from_parent_id, to_parent_id}`, either end null for the root). A folder is an artifact, so all three are artifact
verbs and there is no `folder` object kind to match on.

Rules the service enforces, whatever the caller says: `INTERNAL__SERVICE_SECRET` on every route but `/health`
(`x-artifactbin-service-secret`), one statement per batch with every value BOUND, a 1 MiB body, and a schema name
that is a plain identifier (it is interpolated into DDL). It holds no request identity and opens no outbound
connection but its database. Private network only.

Telemetry never fails the product. `emit` NEVER rejects, on either side of the wire: a failed insert is one
`console.error` and the caller is told nothing, a sink that throws is another and the row still stands, and a
service that cannot be reached costs the caller a log line rather than a request. Nothing in the product may
gate on the log, and a payload carries ids and names — never content, never a secret.

Errors: a body that is not an array of envelopes is `400 {"error":"bad_request"}` with the detail in the operator
log only; a missing or wrong secret is `401 {"error":"unauthorized"}`; a body over the cap is `413`; a GET on
`/emit` is `405`; an unknown route is `404`.

The client's batching (`eventsClient(url, opts)`): `emit` enqueues and resolves at once — it never blocks a
request and never rejects. A batch leaves every `batchMs` (default 1000) or as soon as it holds `batchMax`
(default 50), whichever comes first, one POST in flight at a time so batches arrive in the order they were
queued. A failed POST is retried ONCE after ~100 ms — free, because the envelope ids are the receiver's dedupe
key — and then DROPPED with one `console.error`. Beyond `queueMax` (default 1000) waiting envelopes the newest
are dropped with ONE `console.warn` per overflow episode: telemetry may never grow into the caller's memory.
`close()` flushes the tail and stops the timer — what a SIGTERM handler awaits before the listener closes.

Entry points: `@artifactbin/events` is the contract, the table declaration, the client, the server shell and the
boot (`serveEvents`, `loadEventsConfig`, `runEvents`); `./local` is the writer and the ONLY entry that touches the
database — a composition root hands it a `Queryable` (the single image its own `Db` handle, never a second engine
on one data directory) and it is never imported from the app tree.

Sinks: `runEvents(config, { sinks })` takes a list of `EventSink`s a STORED batch is handed to next. The list is
EMPTY in this repo — a deployment that forwards the log somewhere fills it, and a sink that throws is logged, not
propagated.

Configuration (`loadEventsConfig`): `APP__PORT` (8080; 0 = ephemeral) · `APP__HOST` (0.0.0.0) · `DATABASE_URL`
(required by the process entry; a composition root may inject a `Queryable` instead) · `EVENTS__SCHEMA` (`events`)
· `INTERNAL__SERVICE_SECRET` (required in production). Every missing required name is reported in ONE error, and a
`MODULE__NAME`-shaped name nothing reads is warned about at boot.

Conformance: `__tests__/contract.test.ts` runs one suite over `createEvents({ db })` and over
`eventsClient(serveEvents(createEvents({ db })))`, then the shell's own guards, the client's batching and the boot.

## Backfilling a legacy analytics table

A deployment that counted views in its own table before the log existed can copy that history in ONE idempotent
statement. `backfillSql({ schema, from })` (from `./local`) returns the text; `backfillAnalyticsEvents(db, {
schema, from })` runs it and resolves to the number of rows it took — 0 on every run after the first, because the
ids are stable (`legacy:<seq>`) and the insert is `ON CONFLICT (id) DO NOTHING`. The single image runs it at every
boot, right after it registers the writer.

**It copies only into a log that has not spoken for itself yet**, and the statement asks that question in its own
WHERE. An app that emits also dual-writes the legacy row, so a log holding any row that is not a `legacy:` one is
already covered; copying into it would say each moment twice — the live sentence, whose subject is the account,
beside its `legacy:<seq>` twin, whose subject is the visitor hash. The first run after an upgrade therefore takes
the whole history, and every later one takes nothing.

An operator runs it by hand instead, and runs it **as the database owner**: the events role has read on nothing
but its own schema, on purpose, so it cannot see the app's table. `from` is the legacy table as that connection
sees it — qualify it. Both names are interpolated, so both are refused unless they are plain identifiers
(`from` may carry one dot).

```sql
INSERT INTO events.events (id, at, source, subject_kind, subject_id, verb, object_kind, object_id, payload)
SELECT 'legacy:' || seq, created_at, 'app',
       CASE WHEN visitor IS NULL THEN NULL ELSE 'visitor'::text END, visitor,
       CASE event WHEN 'view' THEN 'viewed' WHEN 'export' THEN 'exported' WHEN 'create' THEN 'created' WHEN 'update' THEN 'updated' WHEN 'edit' THEN 'edited' WHEN 'mutate' THEN 'mutated' WHEN 'revert' THEN 'reverted' WHEN 'fork' THEN 'forked' WHEN 'delete' THEN 'deleted' END,
       'artifact', artifact_id,
       jsonb_strip_nulls(jsonb_build_object('user_id', user_id, 'client', client))
  FROM app.analytics_events
 WHERE event IN ('view', 'export', 'create', 'update', 'edit', 'mutate', 'revert', 'fork', 'delete')
   AND NOT EXISTS (SELECT 1 FROM events.events WHERE id NOT LIKE 'legacy:%')
 ON CONFLICT (id) DO NOTHING
```

What the mapping says: the row keeps its time (`created_at`), its daily visitor hash as the subject (NULL stays
NULL — such a row has nothing to dedupe on and counts once), its artifact as the object, and its account and
client in the payload. A value the table above does not name is not copied: a connection (`sse_connect`) is not a
moment anyone reads back.
