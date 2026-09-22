# Native Windows support: proposal and evidence

Research date: 22 September 2026. Source baseline: `f804ee2`. Worktree: `artifactbin-next-windows-proposal`; branch: `split-windows-proposal`. [Draft research PR](https://github.com/minusxai/artifactbin/pull/63). No product implementation or release is included.

## Recommendation

Build a native Windows 11 x64 release, retaining the existing CLI and Node SEA architecture. Treat distribution, updates, file security and process control as explicit platform boundaries. Do not describe adding a PowerShell script as Windows support.

Deliver core authoring first: install without Node or administrator rights; browser/email authentication; skills; pull, validate, push, sync and export; local SQL, preview and image services; verified updates; and uninstall. Mark the first release a Windows preview until its complete acceptance matrix passes. Background remote agents require a separate lifecycle milestone. Native ARM64 and WSL interoperation remain separately qualified targets.

## Support contract

| Target | Proposed commitment | Qualification |
|---|---|---|
| Windows 11 x64 | First native target; Windows PowerShell 5.1 and PowerShell 7 installation; CLI usable from PowerShell and cmd | Real Windows 11 standard-user acceptance plus Windows Server 2022 CI |
| Windows Server 2022 x64 | Automated build and behavioral runner; headless commands | A hosted runner is not proof of Windows 11 desktop onboarding |
| Windows ARM64 | Follow-on native target | Pinned DuckDB bindings exist; prove SEA, Chromium, sharp, ConPTY and packaged CLI together on ARM64 |
| Git Bash | Invoke the native executable after native installation | Test argument conversion and executable discovery; shell installer should direct users to PowerShell |
| WSL2 | Separate Linux installation and state; explicit documentation | Test browser approval and skill location with agents running inside WSL; no automatic credential/state sharing with Windows |
| Windows 10, network-share state, full native development stack | Outside the first support promise | Reassess explicitly; do not silently imply support |

Current Playwright documentation lists Windows 11+ and Windows Server 2019+; Windows 11 is the proposed client floor. This is not an assertion that every earlier OS fails. [Playwright requirements](https://playwright.dev/docs/intro#system-requirements).

## What is already established

Evidence labels matter: **Windows-observed** means executed on a Windows x64 CI runner; **source-confirmed** means read from this checkout; **pending** means not yet proved. A successful research workflow means observations were collected, not that all capabilities passed.

| Finding | Evidence | Consequence |
|---|---|---|
| Installer and updater reject Windows | Source-confirmed; earlier Mac-hosted platform probes reproduced rejection | New native installation and release selection are necessary |
| Ordinary file replacement works; replacing a running executable fails with EPERM | Windows-observed, Node 22.22.3 | Existing in-place updater cannot simply have its OS guard removed |
| chmod(0600) reports mode 0666 | Windows-observed | Exact POSIX mode checks reject valid Windows cache files; POSIX modes cannot certify private credentials |
| Windows runtime is absent from the pin and release matrices | Source-confirmed | Add build, verification, publication and release-serving coverage together |
| Binary writer adds .exe but manifest binary.file does not | Source-confirmed | One shared artifact-name contract must drive every producer and consumer |
| Browser launch uses xdg-open outside macOS | Source-confirmed | Add a Windows URL-launch implementation and test browser-unavailable recovery |
| Remote worker writes a shell wrapper and runner uses negative process IDs/signals | Source-confirmed | Foreground ConPTY and background process supervision need separate qualification |
| DuckDB 1.5.5-r.4 publishes Windows x64 and ARM64 bindings | Lock/package inspection and npm registry metadata | Do not reject ARM64 based on older documentation listing only x64 |

A corrected native run on **Windows Server 2022 x64 / Node 22.22.3** established the following. [Windows research run](https://github.com/minusxai/artifactbin/actions/runs/35733192790), [retained observations](./evidence.windows-x64.json).

| Native probe | Observed outcome | What this resolves |
|---|---|---|
| Rename running executable aside, then install replacement | Succeeded; replacing after process exit also succeeded | Smaller updater adaptation is viable enough to prototype before adding a launcher |
| Actual esbuild callback with the current slash-only filter | Filter missed the Windows path | Loader-path normalization is a confirmed build fix, not speculation |
| DuckDB query with pinned Node API | Returned answer 42 | Windows x64 SQL dependency works in isolation |
| sharp image generation | Produced a 92-byte PNG | Native image dependency works in isolation |
| node-pty / ConPTY command | Exit 0 and expected output marker | Basic terminal spawning works; resize, signals and descendant cleanup still need tests |
| Pinned Playwright Chromium | Opened local HTML and read its heading | Browser binary launches; packaged cache and full export path remain unproved |
| Minimal Node SEA + postject | Executable reported SEA true and SQLite available | Official Windows Node supports the essential packaging mechanism |

All probes ran under paths containing spaces and Unicode. They used the direct package versions from the repository lock: DuckDB Node API 1.5.5-r.4, sharp 0.35.4, node-pty 1.1.0, Playwright 1.62.1 and postject 1.0.0-alpha.6. Package metadata collection hit sharp's package-export restriction after the functional probes; versions are independently recorded in the uploaded installation manifest and resolved lock. The probe now reads metadata as files to avoid that instrumentation error. Lifecycle cleanup was not certified: the bounded probe explicitly exits after collecting results.

The first native dependency attempt had a research-harness installation-directory error. Its MODULE_NOT_FOUND results are **not** evidence of unsupported dependencies. Corrected runs and any remaining timeouts are recorded separately. Probe dependencies use the repository's exact direct versions, but their isolated transitive resolution is not the full repository lock; the resolved research lock is retained with CI artifacts.

## Boundaries and contracts before implementation

| Owning boundary | Narrow interface / invariant | Affected code |
|---|---|---|
| Release target catalog | Resolve platform, architecture, executable suffix, manifest name and capabilities once; reject unknown targets before writes | services/contracts for shared types; build/update consumers use that contract |
| Verified installation transaction | Discovery, download and verification stay shared; platform adapter activates a staged release and reports completed versus pending accurately | services/cli/src/update.ts, background-update.ts, release manifest scripts |
| Private local storage | Verify effective user-only access before writing credentials; keep byte hashes, confinement and journal recovery on every platform | files.ts, config.ts, state.ts, native-package.ts |
| Process integration | Open a URL, resolve an executable, spawn with literal arguments, interrupt and terminate owned descendants | browser-auth.ts, launcher.ts, foreground-process.ts, runner.ts, remote-worker.ts |
| Native-package assembly | Portable archive paths; host filesystem paths only at extraction; verify bytes/types/links with platform-appropriate permissions | binary.mjs, build-host.mjs, duckdb-native.mjs, runtime-archive.mjs |
| HTTP/discovery surface | Serve the correct installer and teach the correct shell commands; route handlers only translate results | app/server/app.ts, agent-discovery.ts, agent-copy.ts, GetStarted/Chat and generated CLI teaching |

Keep platform behavior in these cohesive modules instead of scattering win32 branches across command handlers. Configuration remains in the owning audited env module; keep local and HTTP service contracts equivalent. No proxy imports into the app.

## Packaging: retain SEA, prove the actual distribution

Node 22.22.3 documents Windows SEA creation, .exe naming and postject injection. This makes the existing architecture a credible starting point; it does not prove our native loaders, minimized runtime or bundled host. [Node SEA documentation](https://nodejs.org/download/release/v22.22.3/docs/api/single-executable-applications.html).

Start the Windows runtime spike with the official checksum-pinned Node executable. Measure its size and startup before deciding whether to port the small-ICU source-build recipe. The current runtime pin validator assumes small-ICU, and the build scripts assume Unix tools and filenames. An official full-ICU Windows runtime would require an explicit recipe contract, not mislabeling its capabilities.

Fix .exe naming across raw executable, gzip, manifest, size report, staging, verification and release downloader. Preserve current macOS/Linux asset names. Replace Unix strip calls on PE/native modules with an intentional Windows packaging path. Normalize paths before esbuild plugin matching and package filters. In particular, build-host.mjs splits paths on '/' and runtimePackageFile only accepts slash-separated PGLite paths; otherwise a seemingly successful build may omit required runtime files. Its execFileSync('npm', ...) also needs Windows-aware command invocation.

Bundle the pinned ConPTY helpers/DLLs and the complete Chromium and SQL dependency trees; test from a directory outside the repository, without Node on PATH, with caches empty and then warm. Minimize only after the unoptimized distribution passes.

## Updates: preserve recovery, do not overwrite a loaded image

The Windows probe makes **rename-aside the provisional first choice**. Prove its crash and concurrency behavior before adding a permanent launcher. The alternatives remain available if that proof fails:

| Design | Advantage | Cost and failure to prove |
|---|---|---|
| Rename current executable aside, then place verified staged executable | Smallest change to existing updater; succeeded while the old image ran in the native probe | Rename behavior, a temporarily missing command, simultaneous starts, antivirus locks and crash recovery; not an atomic two-file swap |
| Stable launcher plus immutable version directories and a current-version record | Activation does not overwrite the running payload; existing sessions can finish on old bytes | New launcher must forward arguments, exit status and console events correctly; launcher upgrades still need their own safe path |
| Exit-and-replace helper | Can wait until executable is unlocked | Must expose pending status honestly, handle interrupted handoff and avoid claiming completed installation before activation |

Start with a journaled rename-aside prototype, now that its OS prerequisite has been observed. Select it only after native fault-injection tests pass. If rename-aside cannot preserve command availability and recovery, use the versioned launcher. An ordinary-data rename passing is insufficient evidence for executable replacement. [Windows file-handle semantics](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-deletefilew).

Shared invariants: verify checksum and release identity before activation; serialize concurrent installers/updaters; preserve the old usable version on verification failure; bind recovery to the expected old/new hashes; retain a rollback version; never remove active payloads; use bounded retries for transient sharing violations. Keep executable and selected skill-version recovery coordinated. Use .exe on staged programs that must be executed for version verification. Test foreground and background update paths separately.

## Installation, trust and local state

Propose a signed PowerShell installer at /chat/install.ps1 plus a documented verified manual download. Support Windows PowerShell 5.1 as well as PowerShell 7; use literal paths and structured arguments. Default executable storage to a per-user directory such as %LOCALAPPDATA%\Programs\afbin, and preserve the existing %USERPROFILE%\.artifactbin state convention plus ARTIFACTBIN_HOME overrides to avoid an unnecessary migration.

Download to a private temporary directory, verify SHA-256 and the expected Authenticode publisher, then activate. Change only the user's PATH, preserve its other entries and order, deduplicate safely, and explain which existing terminals need reopening. Respect enterprise execution policy; do not prescribe machine-wide policy changes or silently bypass restrictions. A signed/downloadable installer and manual binary path must remain available. [PowerShell signing](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_signing).

Credentials and SQLite/WAL files need a Windows ACL contract. Preserve current-user access and necessary system/administrator access while excluding unrelated users. Validate relocated state too; default-profile inheritance is not a universal guarantee. POSIX chmod is not an ACL implementation. On Windows, replace exact mode equality in native cache checks with appropriate access validation, while retaining checksums, sizes, file types and confined link targets. [Node filesystem behavior](https://nodejs.org/docs/latest-v22.x/api/fs.html).

Uninstall removes only owned install files and the PATH entry it added, reports locked leftovers for later cleanup, and makes state deletion explicit. Never remove agent-owned directories or unrelated installations.

Sign final Windows executables after SEA injection and before computing release hashes. Keep signing credentials out of PR jobs; use a separate protected signing boundary, then verify and smoke-test the exact signed bytes that will be published. Signing helps establish publisher identity but does not guarantee a new release has no SmartScreen warning. [Microsoft SmartScreen guidance](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation).

## Commands, paths and remote agents

Preserve shell-free spawning for native executables. Windows .cmd/.bat shims need explicit handling; do not add shell:true to every command. Resolve PATHEXT and case-insensitive PATH keys deliberately, with tests for spaces, Unicode and metacharacters. URL opening must not concatenate an untrusted URL into shell source. Browser-launch failure must retain the existing email-auth/manual approval recovery. [Node child-process documentation](https://nodejs.org/download/release/v22.22.3/docs/api/child_process.html#spawning-bat-and-cmd-files-on-windows).

Use native filesystem paths internally and portable separators in manifests. Exercise drive roots, absolute and relative paths, case aliases, case-sensitive directories, UNC inputs, reserved names, alternate data streams, symlink/junction escapes, long paths, and CRLF/BOM inputs. Do not fix identity by blindly lowercasing every path. Initially reject unsupported network-share state with a precise error rather than assuming local SQLite lock guarantees apply there.

ConPTY availability is only the first terminal gate. Test resize, Unicode, Ctrl+C, normal exit and disconnect; then prove stopping a managed session terminates only its own descendants. Replace the POSIX wrapper and signal/process-group assumptions before enabling background remote agents. Windows Job Objects are a candidate for owned process-tree lifetime, not a complete implementation by themselves. [node-pty](https://github.com/microsoft/node-pty), [Windows Job Objects](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects).

## Risk-ordered execution ledger

Owners below are proposed responsibilities, not assigned people. Effort is an engineering estimate, not measured delivery time; re-estimate after Gate 0.

| Gate | Owner | Work / exit criterion | Estimate |
|---|---|---|---|
| 0 — prove feasibility | CLI/release engineer | Actual Windows SEA plus packaged native services; select update mechanism after crash/concurrency probes; validate ACL strategy on two users | 2–4 engineer-days |
| 1 — foundation | CLI engineer | Target catalog, safe paths/ACLs and Windows process primitives; behavioral tests fail first, then pass on both OS families | 3–5 days |
| 2 — native authoring preview | CLI + release engineer | Packaging, installer, auth, skills, core commands, local SQL/preview/export and uninstall pass on a clean standard-user Windows 11 machine | 4–7 days |
| 3 — supportable release | Release/QA engineer | Update interruption matrix, signed-byte verification, Windows CI selection, platform-aware docs and rollback qualification | 3–5 days |
| 4 — managed agents and ARM64 | CLI/QA engineer | Process-tree shutdown and background recovery; independent ARM64 and WSL qualification | 4–8+ days, re-scope from evidence |

Plan roughly 12–21 engineer-days for the core supported release, plus managed-agent/ARM64 work. Signing-account onboarding and access to Windows test machines can add calendar time. Do not promise dates before Gate 0.

## Release acceptance matrix

| Surface | Required behavioral proof |
|---|---|
| Clean install | Standard user; no Node/Git/sh required; PowerShell 5.1 and 7; spaces/Unicode; non-default directory; idempotent PATH; custom origin |
| Integrity and trust | Bad/missing checksum, wrong arch, corrupt gzip, invalid manifest and wrong publisher all refuse before replacement |
| Auth and secrets | Browser launch and unavailable-browser fallback; disposable mxmx_test_* accounts; two-user ACL denial; custom state directory; no bearer secrets in argv/logs/URLs |
| Core CLI | Offline help/validate; pull-edit-push; sync/conflict recovery; datasets; export; portable paths and CRLF |
| Local services | Empty/warm/offline cache; SQL query; Chromium screenshot; preview server; persisted local state; missing/quarantined DLL recovery |
| Updates | Version N to N+1; concurrent commands; crash at each journal transition; locked files; offline recovery; preserved old bytes; no false success |
| Agent integration | Installed .exe/.cmd discovery; skill locations; foreground PTY controls; background child/grandchild cleanup before enabling that feature |
| Uninstall | Owned files only; unrelated PATH entries and installations preserved; explicit keep/delete-state behavior; locked-file retry |
| Distribution | CI builds and tests Windows asset; protected signing; final signed bytes reverified; published asset set complete; host release pin advanced only after release exists |

Extend ci-plan and its tests, both CLI/runtime matrices, publisher mappings, installer route/MIME tests, and exact-copy gates together. Include agentDiscovery, agent-copy, buildQuickSheet/renderDoc-related assertions and generated teaching consumers when their pinned content changes. Use existing behavioral tests and real handlers with isolated state, then native Windows CI for filesystem/process facts. Full builds, integration and browser gates remain CI-only.

Follow repository TDD: define contracts, establish existing behavior, demonstrate the relevant assertion failing, then implement. Keep focused tests within the local wrapper's cap. No red/green product implementation evidence is claimed by this research.

## Evidence, limitations and decision

Local research-worktree checks: `node --check docs/proposals/windows-support/probe.mjs` passed; `npm run validate` passed. `npm test` exited 2 with **no affected tests: deferred to PR CI, not passed**. A draft PR with an empty body is open and its checks are being inspected. No local full-suite, production build or browser gate was invoked. CI-only native probes tested disposable fixtures and isolated packages, not production.

Research workflow source and evidence live beside this proposal. To reproduce, use the draft PR's Windows research workflow; it installs exact direct dependency versions into a temporary project and uploads observations plus the resolved lock. macOS execution of the script cannot establish Windows filesystem or native build facts.

The previous audit's 57 installer/updater tests passed on macOS in the original checkout; that is prior audit evidence, not a fresh pass in this worktree and not Windows coverage. This proposal does not claim that a complete afbin.exe, Windows installer, authentication flow, ACL design, recovery implementation or managed agent has passed native acceptance.

Proceed with Gate 0 and the proposed Windows 11 x64 contract. Keep the research PR draft; it carries disposable probes and this proposal, not a Windows-support implementation. Remove the research workflow or convert its useful observations into real assertions when implementation begins. Do not merge solely because a research observation job is green.

## Repository source map

Read against the reviewed baseline rather than assuming future main is identical:

- [Installer](https://github.com/minusxai/artifactbin/blob/f804ee2/services/app/public/chat/install.sh), [updater](https://github.com/minusxai/artifactbin/blob/f804ee2/services/cli/src/update.ts), [binary builder](https://github.com/minusxai/artifactbin/blob/f804ee2/services/cli/scripts/binary.mjs).
- [Native cache](https://github.com/minusxai/artifactbin/blob/f804ee2/services/cli/src/native-package.ts), [private files](https://github.com/minusxai/artifactbin/blob/f804ee2/services/cli/src/files.ts), [host assembly](https://github.com/minusxai/artifactbin/blob/f804ee2/services/cli/scripts/build-host.mjs), [SQL plugin](https://github.com/minusxai/artifactbin/blob/f804ee2/services/cli/scripts/sql-native-plugin.mjs).
- [Browser auth](https://github.com/minusxai/artifactbin/blob/f804ee2/services/cli/src/browser-auth.ts), [agent discovery](https://github.com/minusxai/artifactbin/blob/f804ee2/services/cli/src/launcher.ts), [remote worker](https://github.com/minusxai/artifactbin/blob/f804ee2/services/cli/src/remote-worker.ts), [terminal runner](https://github.com/minusxai/artifactbin/blob/f804ee2/services/cli/src/runner.ts).
- [CI](https://github.com/minusxai/artifactbin/blob/f804ee2/.github/workflows/ci.yml), [runtime workflow](https://github.com/minusxai/artifactbin/blob/f804ee2/.github/workflows/cli-runtime.yml), [release publisher](https://github.com/minusxai/artifactbin/blob/f804ee2/.github/workflows/release-cli.yml).
