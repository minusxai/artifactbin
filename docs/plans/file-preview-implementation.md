# File-first implementation

Approved proposal: https://artifactbin.dev/a/qv8TA1 (v28).

1. A foreground file session owns scope, revisions, comments and refresh. Reuse renderer/editor, SQL, journal and host packaging. No hidden publication. Remote reads are limited to selected references and bound host/account credentials.
2. Publication validates recursive JSX dependencies before upload, publishes children first, retains retry results, and writes canonical references to files. Preserve reconciliation and workspace host guards.
3. Persistent `serve --dir` and optional `--db-url` reuse team composition. Remove managed-self code. Update teaching, release inputs and production pin after executable/compatibility gates pass.

Planning proof: 3ff6278, dedicated CI 35079317408, full CI 35079317447. Rerun contracts against shipping commands. Original repository stays untouched.
