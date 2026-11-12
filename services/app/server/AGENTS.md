# Serving and the trust boundary

The Hono server and its host boundaries: `app.ts` (the app page, the API), `public-files.ts` (public files),
`pages-host.ts` (every document on its own origin), `user-host.ts` (anonymous publishing hosts) and `host.ts` (the
composition a downstream deployment builds on). This card also covers `lib/document-serving`, which answers
what an artifact is served as, and the local-file doors in `lib/local-connection`.

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
