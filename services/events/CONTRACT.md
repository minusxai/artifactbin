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
