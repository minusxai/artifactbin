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

## Authorization and deployment boundary

Admin access requires a signed-in browser session with an allowlisted verified
email. Bearer tokens and agent cookies cannot authorize administrative requests.
The proxy resolves the session identity; the app trusts only its attached/signed
actor, never a supplied email header, app profile email, or user ID alone.

The account UI sends an explicit admin header to the separate
`/api/admin/documents` surface. Requests receive an origin check and use the
existing session lifetime. Remove the account from the allowlist or revoke its
session to end access.

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
the actual account ID, target document, version transition, time, and repair
reason. It stores no bearer secrets or document source. Repair and audit commit
in the same transaction. Audit failure must prevent a privileged response/write.
List actions are recorded without storing search terms or source snippets.
