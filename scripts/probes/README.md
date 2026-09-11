# CLI planning probes

These are isolated prototypes against OSS `6feb7140`, not the finished CLI. The product proposal
is https://artifactbin.dev/@ppsreejith/cVcRIp. No production state or user harness directory is changed.

From the OSS root after `npm ci`:

```
node --test scripts/probes/{state,ledger,pairing,fence,skills}.test.mjs
npx vitest run --project api services/app/__tests__/planning-preflight.test.ts
node scripts/probes/packaging.mjs
node scripts/probes/npm-package.mjs
```

`packaging.mjs` temporarily injects lazy PTY loading at build time; it does not edit product source.
Run it under the target Node architecture. It checks help with an unusable extraction temp directory
and then the existing real PTY round-trip test. Darwin x64 was exercised under Rosetta; Linux arm64
and x64 in Docker. The npm package probe makes node-pty optional and bundles the real CLI with lazy
remote loading; its tarball installed and ran help in `node:22-bookworm-slim` without Python/compiler.
The current required-native package failed in that environment. No registry publish was performed.

`auth-browser.mjs` requires `npm run build`; it starts a disposable composed server and prints an
info.json path. Open its authUrl in the agent browser, log in using the disposable test email and
protected local OTP outbox, and approve. The loopback callback checks PKCE/code replay, writes a
private test credential file, publishes/reads and rotates refresh tokens. Revoke the returned
rotated token in that same browser session, then visit checkUrl to verify write/refresh refusal.
Terminate the parent afterward; it stops its child. Credentials stay in its temporary directory.

The pairing tests cover protocol-state decisions only, not integrated headless browser routes.
The ledger uses prototype PGlite tables, not the product artifact schema. The state journal verifies
actual SIGKILL recovery of fixture bytes, not a complete release installer; it rejects observed
symlink destinations but is not a defense against a hostile process racing filesystem syscalls.
Skill tests use fake homes, remembered opt-outs, real file replacements and backups. CLI auth,
installer UI and every harness's final global adapter still need integration acceptance tests.

For the paid executable agent trial, build the prototype:

```
node -e 'require("esbuild").buildSync({entryPoints:["scripts/probes/document-cli.ts"],bundle:true,platform:"node",format:"esm",outfile:".artifactbin/probes/document-cli.mjs"})'
python3 scripts/probes/executable-agents.py --base-url http://localhost:PORT --env-file /path/to/authorized.env
```

Use only an explicitly authorized provider credential. The driver reads FIREWORKS_API_KEY as data,
passes it in child environment, redacts it and the disposable artifact token before saving transcripts,
and denies checkout/credential-directory access with macOS sandbox-exec. It sets isolated PWD and
harness state directories. The driver seeds disposable documents through a test-only browser-mint
fixture; agents cannot mint credentials and get only an isolated token. Their skill files are local.
The HTTP stack is real. No MCP or remote skill is used. Each leg has a 240-second process-group limit. Use PROBE_HARNESSES=opencode and
PROBE_MODEL=accounts/fireworks/models/glm-5p3-flash for the additional GLM leg; PROBE_GRAMMAR=gh
selects the noun/action comparison skin. After building, node --test scripts/probes/cli-options.test.mjs
checks that misplaced flags are refused offline.

Tasks: invalid JSX repair/create, historical restore, concurrent body-edit preservation, clean status
and no-op push. The driver independently reads final server content. This prototype is markup-only,
uses a simple JSON sync fixture instead of the final YAML/lock adapter, and is intentionally too small
to count as the complete CLI/release gate. Analyze structured tool calls and final text, not duplicated
streaming deltas or model reasoning. A single run does not establish statistical reliability.
