# Serving & security

Every artifact has ONE identifier: a 6-character file id, used as the API
handle, the `ref:<id>` target, and the URL. It is an **address, not a secret** —
who may read a document is decided by its visibility, never by guessability:

- **`public`** — anyone with the link can read it, and (for account-owned
  documents) it lists on the owner's public profile at `/@username`. Folder
  pages stay owner-only.
- **`unlisted`** — anyone with the link can read it, but it is never listed
  anywhere.
- **`private`** — the owner's logged-in account, plus any email addresses they
  invite from the page's share menu (an invite can name an address that has no
  account yet; it starts working at that address's first login).

Independently of visibility, the share menu names **people**: each invited
email carries a role — `can view` (reads it when private), `can comment` (also
opens, answers and resolves comment threads on it, but never edits) or `can
edit` (also edits it in place, through the API, reverts and reads history —
never deletes, shares or moves it). A public document can have editors; a
collaborator's own agent tokens edit too, once claimed by their account.

Artifacts published by an **account-owned** token are born `private` — except
images and datasets, born `unlisted`, since they are assets other documents
reference at read time; ones published by an **anonymous** token are born
`public` (there is no account to anchor an ACL to). Agents can pass
`"visibility": "public"` on create or PUT.

Artifacts are served at `/a/<id>`; documents you own also get a pretty URL,
`/@username/<folder>/<id>-<title>`. Any URL carrying the id resolves and
corrects itself, so renaming your handle, retitling, or moving a file between
folders never breaks a link that is already out there. A document that declares
reader controls also carries their state in the address (`?$region=west`), so
the link you copy is the document you were looking at — and an agent can hand
you one already narrowed to what you asked about.

**Fork.** Anyone signed in can take a copy of any document they can read, from
the reader controls on the page — or, for an agent holding a bearer token,
`POST /api/artifacts/<id>/fork`. Content and settings travel, history, comments
and shares do not, and the original is never touched. The copy's footer says where it came from — naming and linking the
source only when that source is `public`, since `unlisted` exists to be listed
nowhere.

Pages run behind a strict CSP: inline script/style allowed, **all external
network blocked**, and a `sandbox` directive gives each artifact an opaque
origin so it can't touch the app's storage. Documents are always
self-contained — but you don't have to make them so by hand.

**Import from the web.** Point at an image, a PDF, a font or a CSV and the
server fetches it once, stores a copy, and serves it from this origin:

- `<img src="https://example.com/chart.png" />` in markup — and the URL STAYS
  in the document. An agent writes what it would write anywhere and reads back
  exactly that; only what a reader is SERVED is swapped for our copy. The same
  goes for `<Video poster>`, `<File src="https://…/paper.pdf" />` and an
  `@font-face { src: url(https://…) }` in the document's own stylesheet.
- `{ "imageUrl": … }`, `{ "pdfUrl": … }` or `{ "csvUrl": … }` on create, when
  you want the file to be an artifact with an id of its own.
- `<meta name="font-display" content="Lobster" />` in `<Helmet>` — any
  Google family, downloaded once, served from here.

Nothing is ever hotlinked: readers never touch the origin host, documents
can't rot when it dies, and no reader's IP leaks to a third party. A URL that
will not fetch is a warning on the publish reply, never a refused document —
that one picture falls back to its alt text.

The copy lives at `/assets/<sha256 of the URL>`, shared across every document
and every user, so a popular URL is fetched exactly once. It is served
`immutable` for a year and with three defensive headers — `sandbox`,
`Content-Disposition: attachment` (a PDF excepted, so the browser's own viewer
opens it) and `nosniff` — because an imported SVG is markup, and a navigation
to one must never become a page on this origin. When a source changes,
`POST /api/artifacts/assets/refresh` re-fetches it: pass a document's `id` for
every URL it names, or one `url`. Nothing else moves — no new version, and the
markup keeps the URL it has.
