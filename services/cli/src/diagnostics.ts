/** Shared recovery vocabulary for runtime errors, local help, the manual and skills. */
export const diagnosticCatalog:Record<string,{meaning:string;fix:string}>={
 auth_required:{meaning:'This remote operation needs credentials for the selected origin.',fix:'Run afbin setup, or set ARTIFACTBIN_TOKEN and ARTIFACTBIN_URL for the selected server.'},
 approval_required:{meaning:'Browser approval is pending; --yes cannot approve it.',fix:'Open verification_url, approve the request, then rerun afbin setup before expires_at.'},
 access_denied:{meaning:'Browser approval was denied.',fix:'Run afbin setup only when you intend to start a new approval request.'},
 approval_expired:{meaning:'The browser approval window expired.',fix:'Run afbin setup to start a new approval request.'},
 cli_update_required:{meaning:'The server requires a newer CLI protocol.',fix:'Run afbin update, then retry the command.'},
 state_conflict:{meaning:'Metadata or content changed since the observed head.',fix:'Inspect afbin diff --remote <ref>, reconcile the changes, then push. Use --force only when you intend a conditional replacement.'},
 version_conflict:{meaning:'The content version changed since the observed head.',fix:'Inspect afbin diff --remote <ref> and reconcile the current content before pushing again.'},
 edit_conflict:{meaning:'The body edit could not be rebased without a conflict.',fix:'Inspect the returned diff and current source; reconcile your proposal before pushing again.'},
 outcome_unknown:{meaning:'A write has no confirmed response; it may have committed.',fix:'Keep the pending request journal and rerun afbin push to recover the frozen request. Do not create another artifact to retry.'},
 pending_recovery:{meaning:'An interrupted operation must be recovered before starting a different write.',fix:'Rerun afbin push. For an uncertain conditional update, afbin pull --force archives the proposal and reads the current head; uncertain creates must be recovered first.'},
 result_deleted:{meaning:'The original create result was deleted; its operation key will never create a replacement.',fix:'Restore that artifact and pull it, or deliberately create a new local file to fork. Keep the recovery record.'},
 wrong_server:{meaning:'The artifact or workspace belongs to a different server origin.',fix:'Use the workspace server; keep work for another server in a separate workspace.'},
 account_mismatch:{meaning:'The authenticated account differs from the workspace account.',fix:'Sign in with the workspace account before retrying. Do not discard tracking or recovery records.'},
 duplicate_identity:{meaning:'Two local files claim the same published artifact.',fix:'Keep one tracked file. To fork a copy, remove id, edit_id, head_version, state and version from its fence.'},
 version_not_writable:{meaning:'Historical selectors are read-only.',fix:'Use @version with pull, diff or log. To restore old content, pull that version into the tracked file and push the file without a suffix.'},
 invalid_reference:{meaning:'The value is not an artifact reference.',fix:'Use <url|id|path>[@version] at the command line, ref:<id> in published markup, and $query for result bindings.'},
 invalid_markup:{meaning:'Static JSX does not satisfy the local authoring grammar.',fix:'Run afbin help markup and correct the indicated source. afbin validate --fix applies mechanical formatting only.'},
 invalid_dataset:{meaning:'A local dataset is not supported tabular data.',fix:'Use CSV or a JSON array of row objects. Use afbin help data for Query and Mutation examples.'},
 unsupported_file_type:{meaning:'This local format cannot be published through native push.',fix:'Use a .jsx document, CSV/JSON rows, or an allowed media/file format. See afbin help publishing-datasets.'},
};
export function diagnosticsHelp():string{return '# Errors and recovery\n\nLocal checks run before authentication. JSON diagnostics retain the same code and fix as terminal output; a server refusal may add current source or a diff.\n\n'+Object.entries(diagnosticCatalog).map(([code,entry])=>`## ${code}\n\n${entry.meaning}\n\n${entry.fix}\n`).join('\n');}
