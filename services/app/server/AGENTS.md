# Serving and the trust boundary

Host boundaries: `app.ts` (app and API), `public-files.ts` (files), `pages-host.ts` (document origins),
`user-host.ts` (anonymous publishing) and `host.ts` (downstream composition). Also covers
`lib/document-serving` and the local-file doors in `lib/local-connection`.

## Rules
- An artifact ID is an address, not a credential: `public` is readable and may be listed on the owner's profile,
  `unlisted` is readable by link only, `private` needs current access. Every read, version, export, stream and
  mutation keeps its own check; IDs and links survive title and folder changes.
- Author code never runs on the app's origin. `/a/<id>` is the app shell plus one frame (`document-frame.ts`);
  its bootstrap carries no page source or author script. A document runs only at `<hex id>.<pages host>`, and
  `/a/<id>/raw` answers under the document sandbox CSP (`raw.server.ts`). The app CSP's `frame-src` admits only
  itself and the pages hosts.
- Other origins frame `/a/<id>` only if listed in `EMBED__TRUSTED_ORIGINS` (`app.ts`).
- One URL map, contracts `url-space.ts` (`/af/url-space.json`): `/api/` (JSON, links), `/af/` (public,
  credential-free files), `/a/<id>/`, `/@handle`, a few fixed paths, else a screen; host allowlists derive from it.
  Public paths are never rewritten from retired root prefixes (`url-space.test.ts`).
- A pages origin is same-site with the app, so on another host it reaches only its own document's doors and the
  public files; everything else stays 403 `forbidden_origin` (`pages-host.ts`). The pages session comes
  from a one-use ticket and a host-only cookie, never the app-session cookie; sign-out ends it server-side.
- Serving assembles runtime configuration, asset URLs and presentation around the saved source, never written
  back into it or a download (`native-html-presentation.server.ts`).
- A request on a publishing host (`user-host.ts`) is a guest's whatever it carries: native read doors only, no
  shared writes. Its page-specific SQL POST reuses canonical page/revision/dataset verification, forces anonymous
  read-only execution, and checks the live handle and eligible true owner before admission and after execution.
- No agent-facing surface issues a credential. The operator mint (`app/api/tokens/route.ts`) is a 404 without
  `ADMIN__SECRET`. Connections are stored hash-only, shown once.
- An export capture holds no session: its short-lived key names the requester the export door admitted
  (`lib/export/read-key.ts`); a requester's render is kept for them alone. The capture's own response
  alone names its page's `/a/<id>/assets` addresses with that key; a keyed answer is never cached, and nothing
  stored, downloaded or shared carries the key.
- A portable download holds canonical source, identity and runtime assets, never a credential. An export also
  carries the rows its reader's `sql` may read through the page (`offlinePageSqlData`); past 16 MiB, none, and
  the copy says so. Create and replace keep only an export's verified source (`verifiedPortableSource`);
  `canonicalizeHtmlPage` refuses `offline-data` or `offline-sql`. A linked local file stays read-only: the local-connection broker strips ambient authority, refuses mutations,
  `authorizePrivate` and `checkSession`, and rechecks revision and public access on every grant.
- `host.ts` opens no socket and imports no local SQL or browser engine and no deployment identity. Customise
  through its narrow options (`documentEditorPolicy`, adapters, session providers, subscribers), never by
  importing a downstream deployment.
- A coordinated change: commit here, then move the downstream pin and run its checks.

## Checks
- `npm test -- --files services/app/server/__tests__/routes.test.ts services/app/lib/__tests__/app-page-csp.test.ts services/app/lib/local-connection/__tests__/server.test.ts services/app/__tests__/downstream-exports.test.ts`,
  plus the edited boundary's own `__tests__` file.
- Own-origin serving in a browser: `node scripts/gate-container.mjs own-origin-script`, once, at the end.

- Delegated canonical reads use only the auth-owned `artifact-read-grant` and `artifact-read` identity RPCs.
  A service must opt in with `artifact_reads: true` in `IDENTITY__SERVICE_AUDIENCES` and present its own
  introspection secret. Issue accepts only `{token}` (a live exchanged service token); read accepts only
  `{grant, artifact_id}`. Grants last one hour, remain bound to the original person/service/parent, and are
  never general API bearers. Keep them in trusted encrypted service storage, never agent sandboxes.
  The fixed app read seam returns allowlisted current canonical source without checkpoints or invitation
  stamping; the auth owner buffers at most 200 KiB and rechecks parent/account and current artifact access
  before delivery. Absent and inaccessible artifacts both answer 404.

- Service workload RPC is `/api/internal/identity/artifact-workload`, authenticated only by the opted-in service's
  own introspection secret. `artifact_workloads` in that audience config holds the operator's fixed
  `authorization_url` and `authorization_secret`; both identity and app hosts need the same configuration.
  The app calls that URL with Bearer callback authorization, no redirects, a 10-second timeout and a 32-KiB
  response cap. Only a signed auth-owned service-workload principal crosses the internal transport; caller
  scopes and human impersonation are refused. Native host workload authority retains its independently admitted publication capabilities.
  The request is exactly `{principal,operation}`. Operations are canonical group HTML read
  `{kind:'artifact-read',artifactId,source:'canonical'}` or new private static HTML
  `{kind:'artifact-create',title,html}`. HTML/output are bounded at 200 KiB, title at 500 characters.
  Each callback receives `{principal,operation,digest,nonce,phase}` (`admission` then `final`); digest is SHA-256
  of JSON with operation fields in the order shown. It must echo digest/nonce and a fresh scope containing
  `allowed:true`, exact `principal`, `role`, `readArtifactIds`, `rootFolderId`, `visibility:'private'`, and for
  creation an opaque stable `creationKey` (at most 200 characters), trusted `publication:{maxArtifacts,maxBytes}`
  (positive integers, at most 10,000 artifacts and 1 GiB cumulatively across that grant), optionally trusted `expectedTitle`.
  The stable key is the canonical publication slot; existing group/operator quotas additionally apply. The RPC
  uses the same canonical workload actor, placement validation, publication intent, cumulative charge and output
  graph as native host publication; no separate group writer or identity bypass exists.
  Scope comes from the service's persisted current authority, never caller assertions. Creation requires editor,
  exact same-group live folder/ancestry, no data declarations, references, remote ingestion or bundles.
  Author scripts, event handlers, embedded contexts, forms, automatic URL loads and CSS URL/imports are refused;
  the exact platform core loader and inert safe navigation links remain allowed.
  Durable creation receipts bind issuer/subject/grant/group and stable slot/action key, survive deletion and
  atomically commit with the page. Same payload replays its original ID; changed payload conflicts; a deleted
  result returns 410 with its ID and is never recreated. Cancellation before final admission refuses dispatch;
  after final admission it cannot retract committed creation. Callback credentials remain operator secrets.
