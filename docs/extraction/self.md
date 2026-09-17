# Local preview and persistent hosting

`afbin preview report.jsx` registers named files if needed, then renders their local contents without publishing.
Registration assigns stable IDs from the selected host/account; `afbin add` can assign them explicitly first.
References use `ref:ID` for datasets/media and `/a/ID` for navigation, never local paths.
Browser edits write back to those files; comments live in client SQLite. Multiple input files
share one foreground session. `--share` permits anyone who can reach that session to edit
and comment on its selected files; names provide attribution, not authentication.

`afbin serve --dir ./team` runs the authenticated persistent server in the foreground.
See [team hosting](team.md) for configuration. There is no managed self instance or daemon.
The client defaults to artifactbin.dev. `afbin config set host <url>` saves a default;
`--server <url>` overrides one invocation. Existing workspace host/account bindings still apply.

```text
~/.artifactbin/
  config.json                       client defaults
  state.sqlite                      workspace tracking, recovery and local comments
  hosts/<origin-id>/                profile.json and credentials.env
  services/sql/<version>/           verified DuckDB downloads
  services/chromium/<version>/      verified Chromium downloads
  services/runtime/<cli-version>/  extracted host runtime
  server/server.env                default persistent server settings
  server/data/pglite/               application database
  server/data/objects/              uploaded files
```

`--dir` relocates server settings and data; `--db-url` changes only the application database.
Client credentials and defaults are never server configuration. PGLite is the embedded default,
Postgres is optional, and DuckDB runs queries in either case. Browser controls use host SQL.
Production can run SQL and browser modules in separate services.

The executable embeds checksum manifests. The shared reader/editor and host runtime downloads
on first preview/serve, separately from the native DuckDB and Chromium packages. `afbin setup --service sql` or
`--service chromium` prepares offline use. No separate SQL executable or installed Node is needed.
