# Client configuration acceptance

Owning module: services/cli/src/config.ts. Retain URL validation and credential shape checks. Replace the implicit first-login default and legacy .env layout with explicit config.json + hosts/<origin-id>/profile.json and credentials.env. No migration reader.

Public commands:
- afbin config set host <origin>: save only, no server boot or authentication.
- afbin config get host: saved value, falling back to artifactbin.dev.
- afbin config set output json|text and updates true|false: client defaults only.
- Explicit command flags take precedence; connection persistence never changes defaults.

Tests:
- First command defaults to artifactbin.dev with no files created by a read.
- A first login to an explicitly selected custom origin saves only that profile/credential; the next unbound command still defaults to cloud.
- Config set host <origin> performs no fetch/launch and creates no server directory; global selection survives another host login.
- Scope an exported ARTIFACTBIN_TOKEN to its explicitly exported origin (or cloud), never infer its scope from a saved default or workspace.
- ARTIFACTBIN_HOME relocates all client files, including auth and refresh when options.env is omitted.
- Precedence is explicit, workspace, environment, saved, fallback; conflicting explicit host against a bound workspace fails before transmitting credentials.
- Each host profile holds one authenticated identity. There is no separate account selector. Server settings remain under server/server.env and are not edited by client config.

Local help/config/validation remain offline. Preview owns a foreground file session; persistent hosting uses `afbin serve`. Selecting a URL never starts a server.
