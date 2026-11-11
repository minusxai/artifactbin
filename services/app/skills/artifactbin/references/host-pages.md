---
name: host-pages
description: "Read to use Artifactbin's af-* components and design systems in another web shell (a host page that is not an Artifactbin page) under a strict Content-Security-Policy, or to show a document inside a shell served at the app's own origin."
---
## Read first

A host page is another web shell that uses Artifactbin's building blocks: the `af-*` components,
the design-system stylesheets and their fonts. They are public, credential-free files served with
`Access-Control-Allow-Origin: *`; they need no Artifactbin runtime, import map or sign-in.
`[[ base ]]/af/manifest.json` lists this deploy's pinned, immutable addresses for each of them,
with an `integrity` hash per file. Read it when you build or deploy the shell, and keep the URLs
it gives you: they never change, while the flat `/af/components/<name>.js` addresses follow every
deploy.

Showing a document itself (its frame, its `sql` and `fetch('/fn/NAME')`) works only for a shell
served at the app's own origin, for example a front door that passes the app's API through
([second example](#a-document-in-a-shell-on-the-apps-origin)). A shell on any other origin can
only frame the app page `/a/<id>` (its origin must be in the deployment's trusted embed list).

## Contents

- [The manifest](#the-manifest)
- [Components and a design system under a strict CSP](#components-and-a-design-system-under-a-strict-csp)
- [A document in a shell on the app's origin](#a-document-in-a-shell-on-the-apps-origin)
- [Sign-in in that shell](#sign-in-in-that-shell)

## The manifest

- `components`: name → pinned module URL (`/af/v1/components/<digest>/<name>.js`). Its chunks sit
  beside it under the same digest and are listed in `integrity` too.
- `styles`: every design system in one sheet; `designSystems.<name>.styles`: one system's sheet
  (`label`, `defaultMode` light or dark). Fonts load from `fonts` (`/af/fonts/`) as text uses them.
- `host`: the document host module (second example); `hostComments`, the comments it loads.
- `theme`: `attributes` and `tokens`, the contract below. URLs are paths on the manifest's origin.

A design system applies when `<html>` carries `data-af-design-system="NAME"` and
`data-af-dark="true"` or `"false"` (set `color-scheme` to match); on a page the platform sets them,
on a host page you do. Every system defines the same tokens, and components read only these
(plus optional `--radius-sm|md|lg|full` and `--shadow-xs|md|lg` overrides): `--background
--foreground --card --card-foreground --popover --popover-foreground --primary
--primary-foreground --secondary --secondary-foreground --muted --muted-foreground --accent
--accent-foreground --destructive --destructive-foreground --border --input --ring --chart-1
--chart-2 --chart-3 --chart-4 --chart-5 --radius --font-display --font-body --font-mono`. Build
the shell's own CSS on them with `var(--name)`, or set them yourself to theme the components.

## Components and a design system under a strict CSP

Components add their styles with an inline `<style>` by default, which a `style-src` without
`'unsafe-inline'` refuses. Put `<meta name="af-styles" content="adopted">` in the head before the
first import: each component then adopts a constructed stylesheet (no element, no nonce). Where a
browser cannot (no `adoptedStyleSheets`), it falls back to a `<style>` carrying the nonce from
`<meta name="af-style-nonce" content="N">`, which also works alone with a nonce policy. Adopted
sheets come after the page's own in the cascade: override a component with a more specific
selector. The host page's policy needs Artifactbin's origin in `script-src` (modules),
`style-src` (the sheet), `font-src` and `connect-src` (the manifest), and nothing inline:

```html
<!doctype html>
<html data-af-design-system="meridian" data-af-dark="false">
<head>
  <meta charset="utf-8">
  <meta name="af-styles" content="adopted">
  <!-- Served with: Content-Security-Policy: default-src 'none'; script-src 'self' [[ base ]];
       style-src [[ base ]]; font-src [[ base ]]; connect-src [[ base ]] -->
  <script type="module" src="/shell.js"></script>
</head>
<body>
  <af-button>Save</af-button>
  <af-tabs value="a"><af-tabs-list><af-tabs-trigger value="a">A</af-tabs-trigger>
  <af-tabs-trigger value="b">B</af-tabs-trigger></af-tabs-list></af-tabs>
</body>
</html>
```

```js
// shell.js: read the manifest once (or at build time), then load pinned files only.
const origin = '[[ base ]]';
const manifest = await (await fetch(`${origin}/af/manifest.json`)).json();
const sheet = manifest.designSystems.meridian.styles;
const link = Object.assign(document.createElement('link'), {
  rel: 'stylesheet', href: origin + sheet, integrity: manifest.integrity[sheet], crossOrigin: 'anonymous',
});
document.head.append(link);
for (const name of ['button', 'tabs']) await import(origin + manifest.components[name]);
```

To check a module's integrity too, add `<link rel="modulepreload" integrity crossorigin>` for it
before importing it. No component calls Artifactbin: each draws what the shell gives it. One
thing such a policy still drops: `af-markdown` aligns table columns with a `style` attribute.

## A document in a shell on the app's origin

`/af/host.js` (pinned as `host`) runs the trusted parent's half of the page bridge without the
app: it asks `/api/page/frame/<id>` for the frame's one-time ticket with this origin's session,
draws the frame with the app page's sandbox, and relays the document's `sql` and
`fetch('/fn/NAME')` as the signed-in reader, pinned to the served revision exactly as the app
page does. It refuses to mount on any origin but the app's; the document's door ignores every
other parent. A reader who may not read the document gets `HostShellError` `not_found`. It shows
the current version only (relays pin the head's revision), never an archived one. The shell's
policy needs `script-src 'self'`, `connect-src 'self'` and `frame-src` admitting the pages host's
documents (`https://*.<pages host>`); a shell on another origin needs only `frame-src [[ base ]]`.

```js
import { mountDocument } from '/af/host.js';
const container = document.querySelector('#doc');
container.addEventListener('af-document-selection', (event) => console.log(event.detail));
const doc = await mountDocument(container, { id: documentId });
doc.setMode('dark');
doc.select('title', { reveal: true });
```

Methods: `setMode`, `setDesignSystem(name, mode)`, `select(path, { reveal })`, `scrollToHash`,
`setUrlValues(search)` (your address's `$` values after Back or Forward), `setInset(px)`,
`followVersion(version)`, `notifyData(datasets)`, `destroy`; `bridge` is the raw bridge. Events
on the container: `af-document-ready`, `af-document-selection`, `af-document-event` (every frame
event), `af-document-scroll`, `af-document-url-values` (`{search, push}`: replace or push),
`af-document-navigate` (a link to an app page: `preventDefault()` routes it yourself; a link to
another document loads in the tab), `af-document-closed`.
Comments: `mountDocument(container, { id, comments: true, presence: true })` loads the
discussion (`hostComments` in the manifest): selection actions by role, pins, threads, replies,
mentions, live updates and new versions. `openComments(panel)` draws the rail in your element
(none: the right edge), `closeComments()`. Events: `af-document-comments`
(`{open, unread, panel}`), `af-document-thread` (`{id}`), `af-document-presence`
(`{viewers, total}`), `af-document-sign-in` (`preventDefault()` routes it),
`af-document-comments-unavailable`. Your theme tokens
restyle it. Not included: uploads (refused), region and cell editing.

## Sign-in in that shell

That shell also draws `/login` when there is no session. Sign in with
[HTTP authentication](http-auth.md) steps 1 and 2, same-origin, then load `/login`
again: it answers `302` to `callbackUrl` when that is a path on this origin, else `/`. Send:
`400` `INVALID_EMAIL`. Sign-in: `200` sets the HttpOnly cookie; `400` `INVALID_OTP`; five wrong
codes `403` `TOO_MANY_ATTEMPTS`; `403` `deployment_admission_required`; another `Origin` `403`.
Sign-out: `POST /api/auth/sign-out` `{}`. OAuth consent stays the app's.
