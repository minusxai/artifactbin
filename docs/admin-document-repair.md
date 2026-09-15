# Administrative document repair

Set `ADMIN__EMAILS=operator@example.com,second@example.com` on the app service to
permit those verified accounts to inspect and repair any live markup document.
The default is empty: access is disabled. Configure it only on the intended
deployment; no hostname or production special case exists in product code.
Changing deployment environment values requires restarting/redeploying the app.
Each privileged request checks the process's current allowlist.

## Browser

Sign in with an allowlisted verified account. In Account, choose **Enter admin
mode** under Document administration. Search titles/source, inspect a document,
edit its source, supply a repair reason, and publish. Leave admin mode when done.
Source is shown as text; this surface never mounts the document runtime. Opening
ordinary document links retains ordinary ownership/sharing and dataset checks.

## CLI

Use an existing authenticated connection for an allowlisted verified account:

```sh
afbin admin list mx.data
afbin admin list mx.data --cursor abc123
afbin admin pull abc123 --output repair.jsx
afbin admin push repair.jsx --reason "Repair legacy mx subscription"
```

These are explicit admin commands. They send `X-Artifactbin-Admin: 1` to the
separate `/api/admin/documents` surface. They do not toggle a persistent global
CLI mode. Ordinary pull/push/query and browser sessions retain ordinary access.
Admin pull requires a new output file; it never overwrites an existing draft.
Admin push only changes source; metadata/sharing in YAML are not repair inputs.
Keep `id` and `edit_id` intact. The server rejects stale edits with
`version_conflict` and the CLI leaves your draft unchanged. After an uncertain
write, pull into a different file and inspect the head before deciding to retry.
Admin files are not registered for ordinary workspace auto-push.

## Authorization and deployment boundary

The proxy resolves verified identity from its own authentication database.
Explicit admin bearer requests perform a fresh user lookup through
`SessionStore.identity`; a custom proxy composition without that optional lookup
cannot authorize CLI admin requests. Both standard full and split compositions
provide it. The app trusts only its attached/signed actor, never a supplied email
header, app profile email, user ID alone, or `ADMIN__SECRET`.

Both the admin header and allowlisted verified identity are required. Cookie
requests receive an origin check. This version uses the existing session/token
lifetime: it does not add MFA, temporary elevation grants, or independent token
scopes. A token belonging to an eligible account can explicitly invoke admin
commands; enabling browser admin mode is not required for CLI use. Remove the
account from the allowlist or revoke its credential to end that access.

Admin access never broadens reader, dataset, sharing, deletion, or secret access.
Browser-session automation is explicitly refused on this surface, so inspecting
an untrusted document cannot expose an elevated reader bridge.

## Persistence and audit

`lib/admin-documents.ts` owns policy and repair behavior; routes only translate
requests. `publishMarkupForArtifact` validates/recompiles source using references
the document owner can access. `commitNormalizedMarkup` preserves node identity,
archives the prior version, stamps the real administrator, and notifies readers.
The edit ID is checked again under the row lock before commit.

The app-owned `admin_document_audit` table durably records list/read/repair actions,
the actual account/token IDs, target document, version transition, time, and repair
reason. It stores no bearer secrets or document source. Repair and audit commit
in the same transaction. Audit failure must prevent a privileged response/write.
List actions are recorded without storing search terms or source snippets.
