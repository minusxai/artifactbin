# OSS executable packaging proof

This CI-only experiment validates the proposed distribution boundary without changing the released CLI.

Contract: one executable carries Node, DuckDB's JavaScript API, and the complete Playwright driver/support
assets. An idle command needs no installation. The first work command downloads only native payload
files into a private cache, loads DuckDB, drives Chromium, and captures a SQL result. Subsequent work
must succeed with the download endpoint closed, outside the checkout, and with no Node/npm on PATH.

`build.mjs` assembles a SEA using the same reviewed runtime and platform injection code as the CLI.
`entry.cjs` is the executable's runtime boundary: embedded drivers, lazy native installation, execution.
`check.mjs` owns the isolated HTTP fixture and child processes; its assertions are the acceptance contract.
The archive and installer are deliberately a probe, not a new production service or public API.
The embedded manifest pins every downloaded file by SHA-256. It retains executable modes and internal
symlinks; staging/rename prevents consumers observing partial installs. Playwright's JS/support files
are extracted from the executable, never fetched from npm. DuckDB's JS API is an embedded CJS bundle,
with the native binding resolved only after installation.
PGLite and its WASM/data assets are also embedded and extracted. A separate storage command checks
PGLite server data and Node's SQLite client state survive closing and reopening in another process,
without a download. The probe never gives two processes ownership of one PGLite directory.

CI runs all four currently supported CLI targets. It checks idle/no download, rejected corrupt download,
concurrent first installation, real SQL plus browser screenshot, offline reuse, and damaged-cache repair.
An additional child disables native installation to prove that the work assertion actually fails.
Linux browser system libraries are runner prerequisites; this does not prove arbitrary Linux distros,
Windows, musl, or the eventual artifact server bundle.

`check-daemon.mjs` exercises the additional `daemon.cjs` lifecycle experiment embedded in the SEA.
It uses the CLI's existing SQLite exclusive-transaction locking pattern, with separate startup and
server-lifetime locks. Only the lifetime lock holder opens PGLite. Discovery verifies a challenge
before sending owner credentials; shutdown uses authenticated HTTP, never a persisted PID as authority.
The checks cover concurrent launch, survival after launcher exit/death, isolated instances, graceful
stop/restart, stale PIDs, foreign listeners, occupied ports, and SIGKILL with an uncommitted transaction.
This validates the process/ownership mechanism using probe routes; actual artifact host integration,
browser session bootstrap, upgrades and full workload draining remain implementation acceptance checks.

Run in CI: `node scripts/probes/executable/build.mjs`, then `node scripts/probes/executable/check.mjs`.
Then run `node scripts/probes/executable/check-daemon.mjs` against that same executable.
