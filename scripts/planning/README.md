# Native Windows npm planning probe

This is a CI-only experiment for the npm-only distribution proposal. It does not
change product packaging, publish an npm release, or change the current installer.
Run through the `Windows npm planning acceptance` pull-request workflow.

The CI job builds the branch's CLI and passes its build to a separate disposable
standard user. That user copies it outside the checkout, removes the redundant
bundled `@artifactbin/sql` dependency, adds a shrinkwrap to the published file list,
packs it, and installs the candidate through `npm.cmd`. Dependencies and Chromium
have separate cold caches. Workspace paths include spaces and Unicode. The test
executes under Windows PowerShell 5.1 Restricted policy.

Assertions cover user-owned installation, fresh-process PATH, the `.ps1` command
resolution failure and `.cmd` alternative, local CSV SQL with an unavailable cloud
endpoint, native sharp and ConPTY execution, warmed `npm exec --offline`, and an
explicit npm update while the CLI is closed. Each assertion and any failure stage
are uploaded in `windows-npm-planning-evidence`.

The boundaries matter: the runner is Windows Server 2022 with Node preinstalled,
not a fresh Windows 11 desktop. Node's directory is explicitly persisted into the
disposable user's PATH because setup-node only changes the runner's process PATH.
This cannot validate the Node GUI installer, SmartScreen, organization policy,
missing/old-Node bootstrap, full offline preview/export, or integrated update
notices. The candidate is a local tarball, not a public registry release. Those
must stay separate outstanding checks in the proposal.
