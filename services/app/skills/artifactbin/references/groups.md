---
name: groups
description: Group setup, defaults and ownership.
---
## Read first

A group is a separate identity, never a user account or artifact. Editors can create/edit/manage group artifacts; viewers can read permitted artifacts and select the group as Home. Links between groups are navigation, never permission grants. Authenticate as the recipient on the supplied deployment; copied instructions carry origin and handle only, never the sender’s credentials.

Use one workflow through an installed CLI or authenticated HTTP. Reuse the artifactbin skill and origin-scoped credentials. New artifacts use an explicit destination, otherwise their parent’s owner, then your account default, then the deployment default, then Personal. Conflicting explicit destination and parent ownership is refused. Changing defaults and ordinary edits never transfer existing artifacts.

## Recipient setup

CLI: `afbin setup --server [[ base ]] --group <handle> --set-default`. For requested setup when afbin is absent: `npx --yes @afbin/cli@latest setup --server [[ base ]] --group <handle> --set-default` (PowerShell: `npx.cmd`). Restart the agent to load the skill. Ordinary setup remains auth-free; explicit group/default selection authenticates first, using normal credential refresh. Chat/headless: [recipient sign-in](publishing-auth.md); ask actual email/code and wait.

This command resolves the handle to immutable `group.id`, verifies editor or viewer membership, saves the account preference, then explicitly saves the canonical server as the local default. `--group` without `--set-default` verifies membership only. `--set-default` without a destination authenticates and selects only the host. Ordinary `setup --server` seeds a missing host and preserves an existing selection. Host precedence: `--server`, exported `ARTIFACTBIN_URL`, saved host, public default.

HTTP: [auth](http-auth.md), then `GET /api/groups/<id-or-handle>`; verify `group.role` is editor or viewer. `PUT /api/me/preferences` with `{"default_destination":{"type":"group","id":"<resolved group.id>"}}`. `GET /api/me/preferences` reads this account’s preference. Use the shared helper for every request, not a second rotating-token copy. Preferences are per account on this origin; HTTP cannot select a local CLI host. Never store group IDs in `.env`.

Personal explicitly overrides a deployment group: CLI `afbin setup --server [[ base ]] --personal --set-default`; HTTP preference `{"default_destination":{"type":"personal"}}`. Clear the account override and inherit deployment defaults: CLI `--inherit --set-default`; HTTP `{"default_destination":{"type":"inherit"}}`.

If the remote preference succeeds but local host writing fails, setup reports `setup_partial_failure` and which side was saved. Retry the same command. Membership/authentication/remote preference refusal leaves the previous local host unchanged.

## Publishing and deliberate transfers

CLI: `afbin push report.jsx --group <handle> --server [[ base ]]` resolves a group ID and requires editor membership. `--personal` selects Personal. Destination flags affect creates only, including new datasets/media and dependency artifacts. Later edits retain their current owner. Omit flags to inherit the parent owner or server defaults; conflicting explicit destination and parent ownership is refused.

HTTP new artifact creation accepts `destination: {"type":"personal"}` or `destination: {"type":"group","id":"<resolved group.id>"}`. Omit it to use the account/deployment default. Viewers cannot publish or edit group artifacts. Inaccessible saved groups are refused; they do not silently fall back to Personal.

Transfers are separate authorized operations; changing a default, folder metadata or creator attribution is not a transfer. Preserve artifact IDs/history and dependency safety. Inspect the group/ownership API’s returned permissions and instructions before a deliberate transfer. Group IDs are distinct from user IDs and never become credential account IDs.
