# Shared source and production composition

Production pins this toolkit as a Git submodule. Its build imports shared TypeScript implementations and interfaces through defined module entrypoints, then bundles each production service and copies its required assets. Shared source is maintained here; production deployment code lives in the private repository. No separate shared-package publication or archive update is required.

| Module | Shared implementation | Production use |
| --- | --- | --- |
| `services/contracts` | Actor, SQL, browser, events and transport types/constants | Same contracts for local and HTTP implementations |
| `services/utils` | Signed HTTP transport, audited config and service clients | Communication between separately deployed services |
| `services/app` | Reader/editor, publication, revisions, references, comments, sharing, permissions, storage and query orchestration | App with Postgres, object storage and remote SQL/browser/events |
| `services/auth` | Login/OAuth, sessions and identity resolution | Authentication composed into the private proxy |
| `services/sql` | DuckDB queries and HTTP shell | SQL service with DuckDB installed |
| `services/browser` | Chromium rendering and HTTP shell | Browser service with Playwright and Chromium installed |
| `services/events` | Event schema, writer and HTTP shell | Events service with its own database and private integration sinks |

OSS combines authentication, the app and local services in one host. It contains no separate proxy or gateway rate-limit implementation. Production owns forwarding, request-rate policy, managed integrations, SQL generation and operator access policy. Feed and third-party browser tracking are excluded from the toolkit.

The app's `createAppHost` entry does not open a socket or load native engines. The production build resolves shared imports from the pinned submodule and installs each service's external dependencies independently. SQL and browser service images receive their respective engines; the app image receives neither. Production copies the shared reader/editor/runtime assets into its app image.

Customization uses existing narrow interfaces: HTTP/local service adapters, authentication session providers, event sinks, a document-editor policy over authenticated claims, and mutation extension hooks. Shared artifact permissions remain authoritative. Production does not import the CLI executable or its client configuration.

For a coordinated change, commit the toolkit change, update production's submodule pin, then run production checks. The production commit and exact toolkit SHA identify the build. Development may test a local submodule branch before committing that pin; CI always checks the committed revision.

## Verification

Original and extracted CLI forms run the same conformance scenarios against the original host. Original and extracted CLIs also run against the OSS host. Production independently builds each source-based service image, checks that the app dependency closure excludes DuckDB/Playwright, and runs its real Postgres/container conformance checks.
