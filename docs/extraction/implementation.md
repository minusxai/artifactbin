# Toolkit extraction execution record

Source reference: artifactbin2 at 83a80d72. Existing production reference: the production checkout at a9cf3d9. Neither deployment changes during extraction.

## Boundaries

Public toolkit owns CLI and shared artifact behavior (reader/editor, publication, queries, comments, sharing, events). Production imports public packages and supplies its proxy/identity, Postgres/object storage, separate compute/events composition and deployment settings. Managed self is a single-owner loopback composition with automatic local credentials; explicitly hosted OSS retains authenticated collaboration. No feed. No new config/credential/data migration framework.

Keep cohesive source modules during extraction; introduce only the interfaces needed by real consumers. Existing schema initialization and behavior remain intact. Tests and generators move with their modules.

## Ordered acceptance

- [ ] Baseline: portable CLI/HTTP conformance and existing browser gates against isolated current real host; controlled negative assertion; record CI evidence.
- [ ] M1: independent public checkout and packaged CLI work against reference host; moved tests, generators and complete imports pass CI.
- [ ] M2: self bootstrap/config/lifecycle, packaged engines and browser host; applicable conformance plus collaboration mode; all required platform and browser CI gates.
- [ ] M3: production consumes packed public libraries, no sibling-source imports, no native engines in app; current/extracted CLI versus current/extracted host matrix and production image/compose gates.

Product source copying starts only after the baseline gate passes. Required heavy builds, Chromium, Docker and broad suites run in CI. No release/deploy workflows are dispatched by this work. Each implementation milestone has its own reviewed commit and recorded result.
