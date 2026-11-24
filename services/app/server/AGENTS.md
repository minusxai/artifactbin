# Serving and the trust boundary

Hosts: `app.ts` (with `app-policy.ts` the app page CSP, `app-shell.ts` its HTML, `document-address.ts` admission of the
document an address names), `public-files.ts`, `pages-host.ts`, `user-host.ts`, `host.ts`. Also covers
`lib/document-serving` and `lib/local-connection`.

## Rules
- An artifact ID is an address, not a credential: `public` is readable and may be listed on the owner's profile,
  `unlisted` is readable by link only, `private` needs current access. Every read, version, export, stream and
  mutation keeps its own check; IDs and links survive title and folder changes.
- Author code never runs on the app's origin. `/a/<id>` is the app shell plus one frame (`document-frame.ts`);
  its bootstrap carries no page source or author script. A document runs only at `<hex id>.<pages host>`, and
  `/a/<id>/raw` answers under the document sandbox CSP (`raw.server.ts`). The app CSP's `frame-src` admits only
  itself and the pages hosts.
- Other origins frame `/a/<id>` only if listed in `EMBED__TRUSTED_ORIGINS` (`app-policy.ts`); with a custom shell, also the
  shell's embedded chat, `/conversations?embed=1` (`appPagePolicyAt`).
- One URL map, contracts `url-space.ts` (`/af/url-space.json`): `/api/` (JSON, links), `/af/` (public,
  credential-free files), `/a/<id>/`, `/@handle`, a few fixed paths, else a screen; host allowlists derive from it.
  Never rewrite public paths from retired root prefixes.
- A pages origin is same-site with the app, so on another host it reaches only its own document's doors and the
  public files; everything else stays 403 `forbidden_origin` (`pages-host.ts`). The pages session comes
  from a one-use ticket and a host-only cookie, never the app-session cookie; sign-out ends it server-side.
- Serving assembles runtime configuration, asset URLs and presentation around the saved source, never written
  back into it or a download (`native-html-presentation.server.ts`).
- A request on a publishing host (`user-host.ts`) is a guest's whatever it carries: native read doors only, no
  shared writes. Its page-specific SQL POST reuses canonical page/revision/dataset verification, forces anonymous
  read-only execution, and checks the live handle and eligible true owner before admission and after execution.
- App title paths check each owned folder and leaf with its ordinary title access. On publishing hosts, readable paths use unique public sibling titles relative to the site root. Configured directories (including an explicit workspace root) require a direct public HTML index. Unconfigured hosts retain their legacy home.
- No agent-facing surface issues a credential. The operator mint (`app/api/tokens/route.ts`) is a 404 without
  `ADMIN__SECRET`. Connections are stored hash-only, shown once.
- An export capture holds no session: its short-lived key names the requester the export door admitted
  (`lib/export/read-key.ts`); a requester's render is kept for them alone. The capture's own response
  alone names keyed asset addresses; never cache keyed answers or store/share/download their credentials.
- A portable download holds canonical source, identity and runtime assets, never a credential. An export also
  carries the rows its reader's `sql` may read through the page (`offlinePageSqlData`); past 16 MiB, none, and
  the copy says so. Create and replace keep only an export's verified source (`verifiedPortableSource`);
  `canonicalizeHtmlPage` refuses `offline-data` or `offline-sql`. A linked local file stays read-only: the local-connection broker strips ambient authority, refuses mutations,
  `authorizePrivate` and `checkSession`, and rechecks revision and public access on every grant.
- `host.ts` opens no socket and imports no local SQL or browser engine and no deployment identity. Customise
  through its narrow options; never import a downstream deployment.
- Coordinate downstream changes through a committed upstream pin and its checks.

## Checks
- `npm test -- --files services/app/server/__tests__/routes.test.ts services/app/lib/__tests__/app-page-csp.test.ts services/app/lib/local-connection/__tests__/server.test.ts services/app/__tests__/downstream-exports.test.ts`,
  plus the edited boundary's own `__tests__` file.
- Own-origin serving in a browser: `node scripts/gate-container.mjs own-origin-script`, once, at the end.
