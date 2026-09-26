# Toolkit boundaries

The toolkit owns the CLI, foreground preview/server, reader/editor, publication, revisions,
ID references, comments, sharing, permissions, storage, events and query orchestration.
Modules live under `services/` with explicit source interfaces. Production-only policy,
proxy/rate limits, generation, operator access and marketing are outside this repository.

The client uses SQLite. The OSS server defaults to PGLite and accepts Postgres; SQLite
(the official wasm build) handles document queries. Local preview reads registered files by ID and saves browser edits without
publishing. `afbin serve` hosts the shared HTTP application with persistent storage and real
authentication. There is no managed self daemon or publication-time path rewriting.

Other deployments pin this source tree and compose the same modules with their own identity,
Postgres/object storage and local or HTTP compute adapters. They import module entrypoints,
not CLI commands or an unpinned sibling checkout.

CI checks source, installed-package and standalone-client compatibility, reader/editor browser
flows, persistence, permissions and real SQL/rendering. Release publication uses the four-platform
executables tested by successful main CI; downstream deployment has its own compatibility checks.

See [client configuration](client-config.md), [hosting](team.md),
[preview](self.md) and [shared source](packages.md).
