# Extraction contract

The original product remains the behavior reference. This checkout becomes the public toolkit; the production checkout consumes compiled package artifacts from it.

The first milestone retains internal source paths to preserve tests and generators. CLI source/build dependencies travel together. Public package exports, rather than directory renaming, establish downstream boundaries. No import may resolve through a sibling checkout.

The standalone host is a cohesive artifact application: reader/editor, comments, sharing, publication, references, access policy and query orchestration. Its composition selects identity, storage and service adapters. Production imports those APIs, never CLI commands or client configuration.

Required checks: existing module suites and generated inputs; clean source/package/executable builds; unchanged portable conformance against the recorded reference host. Local `npm test` retains the 50-file cap; broad suites, production builds, Chromium, Docker and packaged executable proofs run in CI.

A successful main CI run publishes the tested CLI release assets when the CLI version changes; runtime maintenance is a maintainer-dispatched workflow. This checkout contains no cloud deployment workflow.

The initial `apps/` and `packages/` planning placeholders have been removed. Real source workspaces remain under `services/`; compiled public exports define production reuse.
