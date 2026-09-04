# The events service contract

The log of what happened, one service owning it in a schema of its own. `@artifactbin/contracts` `EventsService` is the interface; this file is the wire.

| Method | Route | Body | Answer |
|---|---|---|---|
| `emit` | `POST /emit` | `EventEnvelope[]` | `{ accepted: number }` — envelopes received; storage is `ON CONFLICT (id) DO NOTHING`, so a replayed envelope is harmless |
| — | `GET /health` | — | `200 {"ok":true}` — the Docker HEALTHCHECK and the compose `depends_on` condition; the one GET, every other route POST-only |

(Filled in by P1 — the shell, the secret, the body cap, the client's batching and the conformance suite.)
