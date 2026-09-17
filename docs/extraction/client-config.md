# Client configuration

Owning module: `services/cli/src/config.ts`. It validates URLs and credential shapes, and keeps client
state as `config.json` plus `hosts/<origin-id>/profile.json` and `credentials.env`. There is no
migration reader for an older layout.

Public commands:
- `afbin config set host <origin>` saves the value only — no server boot and no authentication.
- `afbin config get host` returns the saved value, falling back to artifactbin.dev.
- `afbin config set output json|text` and `updates true|false` set client defaults only.
- Explicit command flags take precedence; connection persistence never changes defaults.

Behaviour this pins:
- The first command defaults to artifactbin.dev, and a read creates no files.
- A first login to an explicitly selected custom origin saves only that profile and credential; the
  next unbound command still defaults to cloud.
- `config set host <origin>` performs no fetch or launch and creates no server directory; a global
  selection survives another host login.
- An exported `ARTIFACTBIN_TOKEN` is scoped to its explicitly exported origin (or cloud); its scope is
  never inferred from a saved default or a workspace.
- `ARTIFACTBIN_HOME` relocates all client files, including auth and refresh, when `options.env` is omitted.
- Precedence is explicit, workspace, environment, saved, fallback; an explicit host that conflicts with
  a bound workspace fails before any credential is transmitted.
- Each host profile holds one authenticated identity. There is no separate account selector. Server
  settings live under `server/server.env` and are not edited by client config.

Local help, config and validation are offline. Preview owns a foreground file session; persistent
hosting uses `afbin serve`. Selecting a URL never starts a server.
