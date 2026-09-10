# MCP removal: operation inventory

Source audit of all 15 entries in `services/app/lib/operations/registry.ts` at `6feb7140`.
This is a route/contract audit, not a claim that every new CLI adapter has executed successfully.
Keep the operation implementations and HTTP authorization; remove MCP transport only after parity.

| Existing operation | Proposed common form | Existing HTTP operation |
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
| export_artifact | api '/a/{id}/export?format=png' redirected to a file | GET /a/{id}/export |
| fork_artifact | copy/remove identity/push for ordinary fork; exact server semantics via api | POST /api/artifacts/{id}/fork |
| refresh_asset | api --method POST --input | POST /api/artifacts/assets/refresh |

The export route explicitly resolves bearer OR browser credentials and checks read access before
rendering. Binary api results must stream raw bytes outside JSON mode; JSON mode uses an explicit
content_type/encoding/data envelope. Never mix diagnostic prose into redirected bytes.

New required server work that operation parity alone does not cover:

- **New annotation threads:** currently only POST /api/my/artifacts/{id}/annotations can create them,
  with browser authentication. Extract its input/anchor handling and reuse `createAnnotationFor` in a
  bearer operation. Preserve commenter/editor/owner policy and author provenance. A quote-only CLI
  anchor must resolve uniquely to a persistent node; ambiguous text is refused, never guessed.
- **Metadata/link governance:** expose the existing shared policy to bearer operations with atomic
  expected-state checks; editors cannot escalate sharing. Only changed fields count as governance.
- **Pagination:** current list/version operations return arrays, not the proposed cursor protocol.
  Add stable ordering and cursor/limit contracts to the shared operations before advertising flags.
- **Source edits schema:** the HTTP handler accepts source/edit_id, but the registry input describes
  only old/new string edits. Make the shared schema describe all supported HTTP inputs so generated
  CLI help and validators do not accidentally reject the reused editor protocol.
- **Replacement response:** markup is omitted when `markup_changed:false`. The CLI must retain the
  submitted body in this case and use returned id/edit_id/version; no extra GET is necessary. A
  changed response supplies canonical markup. Unknown/incomplete success responses require recovery,
  not blindly repeating a possibly committed write.
- **Auth removal boundary:** OAuth access tokens work for HTTP today. Keep browser identity, PKCE,
  refresh and revocation; remove the MCP audience/discovery assumptions rather than deleting auth.

Advanced `api` preserves each operation's real preconditions. It must not invent dry-run support for
mutate/refresh/export or suggest that GET means no server activity: export renders and emits an event.
Dry-run cannot trigger onboarding, refresh credentials or update skills; missing/expired credentials
return an actionable auth error instead of mutating state during preflight.
