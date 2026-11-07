# Serving and security

An artifact ID is an address, not a credential. `public` artifacts are readable
and may appear on the owner's public profile; `unlisted` artifacts are readable
by link without appearing there; `private` artifacts require current access.
Folders have owner-scoped listings. Share roles separately grant viewing,
commenting or editing; neither a public page nor an unlisted URL grants dataset
write access. Reads, versions, exports, streams and mutations retain their own
access checks. IDs and existing links survive title and folder changes.

## The native reader boundary

`/a/ID` is the trusted app shell: navigation, sharing, comments and presence
surround a frame containing the authored HTML. The shell bootstrap does not
contain the page source or author script. Each hosted document runs on its own
origin beneath `APP__PAGES_HOST`. A one-use document ticket establishes the
reader's host-only pages session; it is not an app-session cookie. Guest frames
remain guest frames, and sign-out invalidates pages sessions server-side.

`/a/ID/raw` serves the native page with a sandbox policy; it is not permission to
execute author code on the trusted app origin. Current document serving is owned
by `lib/document-serving/native-html.server.ts` and `lib/html-runtime`. Publication
stores canonical HTML and immutable backend bindings. Serving assembles runtime
configuration, approved asset URLs and presentation separately; those wrappers
never become the saved source.

Normal authored scripts run within the document's isolation and CSP. The core
script provides the hosted import map before author modules. CSP extensions use
native `<head>` declarations, for example
`<meta name="csp-connect" content="https://api.example.com">`; publish validates
origins, and reader trust/consent controls admission. Do not assume that arbitrary
external scripts, frames or connections are admitted. Native pages permit author
inline code within their isolated runner policy; app chrome retains its separate
policy.

Keep tokens, session cookies and secret values out of page HTML, local state,
source files and publication requests. The trusted parent handles authenticated
page transport; author code receives no account bearer. Public runtime modules
(`/af/core.js`, `/af/apollo.js`, `/af/reader.js`, `/af/chrome.js`, `/af/portable.js`,
`/af/morph.js`) contain code only, are revalidated by ETag and never cache viewer
state. Retained content-addressed module aliases serve exact digest-checked bytes.

## Data and backend execution

Native `<link rel="af-dataset">` and `<link rel="af-resolver">` declarations bind
unique GraphQL namespaces. The page version pins backend versions and any pinned
dataset revisions; live datasets use current data. Page GraphQL at
`/api/artifacts/ID/graphql` checks page access, revision and current authority.
Dataset ACLs and row/column write policies apply independently. Its reserved
read-only `_sql` root reads the same links of the same revision as the reader:
each dataset's role view (hidden columns absent, row filters and limits applied),
refused for a table whose rule does not allow SQL (`allow_aggregations`), under
the same read fences; it never writes. Viewer-local Apollo
state is private browser state, not a shared database or an authorization source.

An image export (`/a/ID/export`, `export_artifact`) shows what its requester may
read. The exporter's capture has no session; its short-lived key names the
requester the export door admitted, and the capture's page GraphQL reads run as
that requester, queries only, under the same checks. Renders read as nobody may
be shared; a requester's render is stored for that requester alone and re-made
when their access to the page's datasets changes.

A backend source file exports GraphQL types and resolvers. Publication validates
and bundles it server-side. The RunnerService executes pinned code with trusted
principal and capability checks; the browser never fetches the backend source as
a module. The backend store uses compare-and-swap. Public fetches and declared
owner secret bindings have distinct constrained capabilities. Secret values are
configured through the owner-only backend secret API, encrypted separately and
excluded from source and downloads. Do not return them from resolvers.

The retained runner HTTP capability endpoint accepts only host-attested immutable
backend operations with matching source identity. It is not an arbitrary agent
command door. Command-program artifact publication is refused; the old inline
server-script invocation workflow is not a native HTML API.

Dataset attachments upload through the trusted frame and require current insert
authority, provenance and file-policy checks. References and downloads remain
dataset-scoped. Removing a reference does not delete bytes. Archived, raw and
portable readers cannot upload. See [file uploads](file-uploads.md).

## Portable HTML and local connections

`GET /a/ID/download` exports one HTML file after current access checks; `?version=N`
selects an archived version. The file contains canonical source, portable identity
and runtime assets, never credentials. Local UI state works offline. It does not
snapshot arbitrary remote backend results, queue mutations or grant shared write
access. Readable raster image references can be packed; external URLs, CSS images
and `srcset` are not automatically made portable. Unsupported or inaccessible
referenced images can refuse export. Test the file without a network before
promising offline completeness.

An unpublished local project can use the skill's `scripts/serve.mjs`. To publish
from the browser, `/local/publish` asks a signed-in account to select the HTML and
any dependency files, review the plan and publish a private linked copy. Only
explicitly selected files are available; publication does not silently rewrite
the disk source. Save or download the linked HTML explicitly.

A linked file connects through `/local/connect` and the platform broker.
`/api/local-connection` grants short-lived public-reader capabilities through
same-origin browser doors. The broker strips ambient account authority, rejects
mutations before backend execution, checks revision and current public access,
and revokes stale/unavailable grants. `authorizePrivate` and `checkSession` are
refused. Open the hosted original for sign-in, comments or shared changes. A
connected portable file remains read-only for remote operations.

## Retained account workflows

- **Start:** `/start` creates a private native page for an authenticated account;
  `/start?agent=1` requests the agent handoff. `POST /api/start` returns the page
  ID, URL, edit ID and prompt, never a bearer or anonymous ownership cookie.
  Signed-out visitors must sign in before creation.
- **Folders:** create `{format:"folder",title:"Reports"}` and use its ID as
  `parent_id`. Listings, moves, trash and restoration keep ownership checks;
  a folder has no page content of its own.
- **Custom domains:** when enabled, account settings attach and verify DNS through
  `/api/my/domain` and `/api/my/domain/verify`. Choose an owned public HTML page
  as homepage or set exact custom paths, or keep the public profile listing.
  Domain pages read as guests through the domain's own GraphQL endpoint; shared
  mutations are refused. Use the original hosted page for authenticated work.
- **Notifications:** the bell and `/notifications` retain membership, social and
  conversation notifications with current-access checks and read revisions.
  `/account#notifications` manages preferences where delivery is configured.
  See [notifications](notifications.md).
- **Analytics:** workspace view totals and daily series read the events log with
  the existing fallback. View fingerprints rotate daily; telemetry does not
  grant access or determine product authorization. Missing optional event tables
  yield empty analytics rather than breaking the workspace.

Media URL inputs (`imageUrl`, `pdfUrl`, `csvUrl`) fetch a stored copy at publication
under ingestion and quota checks. Ordinary external HTML URLs remain network
resources subject to CSP; publishing a URL in HTML does not promise a stored
copy. Generic file downloads preserve bytes and use attachment, sandbox and
nosniff protections. See [HTTP API](http-api.md) and [document format](document-format.md).
