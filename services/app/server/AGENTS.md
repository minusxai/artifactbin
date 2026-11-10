# Serving and the trust boundary

The Hono server and its host boundaries: `app.ts` (the app page, the API, the static tree), `pages-host.ts`
(every document on its own origin), `user-host.ts` (anonymous publishing hosts) and `host.ts` (the shared
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
- A pages origin is same-site with the app, so on another host it reaches only its own document's doors and the
  static directories; everything else stays 403 `forbidden_origin` (`pages-host.ts`). The pages session comes
  from a one-use ticket and a host-only cookie, never the app-session cookie; sign-out ends it server-side.
- Serving assembles runtime configuration, asset URLs and presentation around the saved source; none of it is
  ever written back into the source or a download (`native-html-presentation.server.ts`).
- A request on a publishing host (`user-host.ts`) is a guest's whatever it carries: native read doors only, and a
  function answers GET only. Shared writes there are refused.
- No agent-facing surface issues a credential: no public mint, no token page, nothing that asks a person to paste
  one. The operator mint (`services/app/app/api/tokens/route.ts`) is a 404 without `ADMIN__SECRET`. Connections
  are stored hash-only and shown once.
- An export capture holds no session: its short-lived key names the requester the export door admitted
  (`lib/export/read-key.ts`), and a requester's render is kept for that requester alone.
- A portable download holds canonical source, identity and runtime assets, never a credential. A linked local
  file stays read-only: the local-connection broker strips ambient authority, refuses mutations,
  `authorizePrivate` and `checkSession`, and rechecks revision and public access on every grant.
- `host.ts` opens no socket and imports no local SQL or browser engine and no deployment identity: production's
  app image excludes Playwright and native SQL. Customise through its narrow options
  (`documentEditorPolicy`, service adapters, session providers, event subscribers), never by importing a
  downstream deployment.
- A coordinated change: commit here, then update the downstream submodule pin and run its checks there.

## Checks
- `npm test -- --files services/app/server/__tests__/routes.test.ts services/app/lib/__tests__/app-page-csp.test.ts services/app/lib/local-connection/__tests__/server.test.ts services/app/__tests__/downstream-exports.test.ts`,
  plus the edited boundary's own `__tests__` file.
- Own-origin serving in a browser: `node scripts/gate-container.mjs own-origin-script`, once, at the end.
