# Get the CLI working on Windows

A Windows user should be able to install afbin, sign in, and publish an artifact. Use the existing CLI and packaging approach. Initial target: Windows 11 x64.

## Four steps

1. **Build the Windows executable.** Add a Windows x64 build to the existing release workflow. Fix executable names, build paths and native dependency packaging.
2. **Fix essential compatibility issues.** Make browser login, local files, credential permissions and dependency caches work on Windows. Keep existing command behavior.
3. **Add the installer.** A PowerShell script downloads the executable, verifies its checksum, installs for the current user and adds afbin to PATH. No Node installation or administrator access required. Include skill setup and clear Windows instructions.
4. **Test the shipped files.** On a clean Windows machine, install the actual release and complete the workflow below. Add that smoke test to Windows CI.

## Done means this works

Install → sign in → create or pull → edit → validate → push → open the published artifact.

Also check a path containing spaces or Unicode, a fresh terminal finding afbin, and a failed checksum leaving the existing installation untouched.

## What we already know

[Native Windows tests](https://github.com/minusxai/artifactbin/actions/runs/35733978760) confirmed that Node executable packaging, SQLite, DuckDB, image generation, Chromium and basic terminal spawning work in isolation. The complete packaged CLI and installer still need the test above.

## Keep the first version focused

Leave ARM64, background remote agents and enterprise deployment for later. Use installer-based upgrades with afbin closed; disable automatic self-updates on Windows initially. This avoids adding a new launcher or update system.

This replaces the longer proposal and its estimate. Implementation has not started.

[Proposal artifact](https://app.artifactbin.dev/a/vKhNMU) · [Research PR #63](https://github.com/minusxai/artifactbin/pull/63). Detailed research and probes remain in Git history and alongside this file.
