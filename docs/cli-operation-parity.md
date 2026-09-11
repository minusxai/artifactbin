# CLI and HTTP operation coverage

All 15 operation implementations retain HTTP access and authorization. The MCP route and SDK are removed.
The shared operation schema generates `afbin api` guidance in the local help and skill bundle.
Real-handler coverage: `advanced-http-parity`, `cli-advanced-http`, `cli-comments`, `cli-pages`,
`cli-preconditions`, and `cli-sync-integration`.

| Existing operation | CLI form | Existing HTTP operation |
| --- | --- | --- |
| create_artifact | push new-path | POST /api/artifacts |
| update_artifact | push tracked-path (conditional replacement where needed) | PUT /api/artifacts/{id} |
| edit_artifact | push tracked-path (body source/edit_id) | POST /api/artifacts/{id}/edits |
| get_artifact | pull | GET /api/artifacts/{id} |
| annotate | comment --reply --body --resolve; reopen via api | POST /api/artifacts/{id}/annotations/{annotation_id} |
| list_artifacts | list | GET /api/artifacts |
| list_versions | log | GET /api/artifacts/{id}/versions |
| get_version | pull ref@version | GET /api/artifacts/{id}/versions/{version} |
| revert_artifact | historical pull then conditional push; exact operation via api | POST /api/artifacts/{id}/revert |
| delete_artifact | delete | DELETE /api/artifacts/{id} |
| restore_artifact (undelete) | api --method POST | POST /api/artifacts/{id}/restore |
| mutate_dataset | api --method POST --input | POST /api/artifacts/{id}/mutate |
| export_artifact | api '/artifacts/{id}/export?format=png' redirected to a file | GET /api/artifacts/{id}/export |
| fork_artifact | copy/remove identity/push for ordinary fork; exact server semantics via api | POST /api/artifacts/{id}/fork |
| refresh_asset | api --method POST --input | POST /api/artifacts/assets/refresh |

The export route explicitly resolves bearer OR browser credentials and checks read access before
rendering. Binary api results must stream raw bytes outside JSON mode; JSON mode uses an explicit
content_type/encoding/data envelope. Never mix diagnostic prose into redirected bytes.

Implemented contracts beyond transport parity:

- Bearer annotations share browser anchoring and access rules. Ambiguous quote anchors are refused.
- Metadata writes use PATCH with an expected-state fingerprint; editors cannot escalate sharing.
- Lists, versions and comments have bounded cursor pages. Cursors are opaque positions, not credentials;
  every request repeats authorization. Start a new listing when changing its filters or artifact.
- Source edits accept the complete body and edit_id, a single replacement, or a replacement batch.
- A successful unchanged-source response retains the submitted body locally, avoiding a second GET.
- Local help, validation, status, diff and unchanged push do not authenticate or contact the server.

Native CLI acceptance exercises publish, body and metadata edits, historical restore, conflict recovery,
dependencies, forks, comments, pagination, one-time Markdown conversion, lost-response recovery,
setup and a real standalone update. The two pi/DeepSeek and two OpenCode/GLM release runs each passed
all 20 checks. See `cli-implementation-progress.md` for the final validation record and remaining gates.
