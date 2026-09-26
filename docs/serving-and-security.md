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
edit` (also edits it in place, through the API, reverts, reads history and
manages its visibility and share list — never deletes it, moves it or takes
ownership). A public document can have editors; a
collaborator's own agent edits too, through the CLI connection their account
holds.

Artifacts published through an **account-owned** connection are born `private`
— except images and datasets, born `unlisted`, since they are assets other
documents reference at read time; ones published through an **anonymous**
connection are born `public` (there is no account to anchor an ACL to). Agents can pass
`"visibility": "public"` on create or PUT.

Artifacts are served at `/a/<id>`; documents you own also get a pretty URL,
`/@username/<folder>/<id>-<title>`. Any URL carrying the id resolves and
corrects itself, so renaming your handle, retitling, or moving a file between
folders never breaks a link that is already out there. A document that declares
reader controls also carries their state in the address (`?$region=west`), so
the link you copy is the document you were looking at — and an agent can hand
you one already narrowed to what you asked about.

**Fork.** Anyone signed in can take a copy of any document they can read, from
the reader controls on the page — or, for an agent, `afbin fork <ref>`
(`POST /api/artifacts/<id>/fork`). Content and settings travel, history, comments
and shares do not, and the original is never touched. The copy's footer says where it came from — naming and linking the
source only when that source is `public`, since `unlisted` exists to be listed
nowhere.

Pages run behind a strict CSP: inline script/style allowed, **all external
network blocked**, and a `sandbox` directive gives each artifact an opaque
origin so it can't touch the app's storage. Documents are always
self-contained — but you don't have to make them so by hand.

Author scripts run in a second opaque child reached through the fixed
`/story/author-frame` wrapper, never in the visible renderer. A bounded
MessagePort exposes only declared values, query refreshes and permitted
dataset mutations. Managed `<Iframe>` assets are imported through the
document-scoped resolver and served anonymously from `APP__ASSETS_ORIGIN`;
arbitrary network, navigation, account APIs and parent DOM access remain denied.

**Data.** A document's `<Import>`s, `<Query>`s and `<Mutation>`s are compiled
at publish — against the artifacts it may read, by the SQLite engine the
server runs them on — and a statement that reads something it may not, or
writes anything but one imported table or local table Value, is refused
there. On the server every statement runs in a throwaway SQLite database,
inside a small pool of worker threads (so a slow query never holds up another
request), with a row cap and a deadline; each import is only the rows its
reader may see. A write runs only as a declared `<Mutation>` of a document the
reader can open, against a dataset opened for writes, under that dataset's
data policy; `$_me.id` is the signed-in reader's id, bound by the server, and
a guest is asked to sign in before a write that reads it. A connected Postgres database
is queried inside itself (`<Query source="ref:…">`), read-only, through its
exposure whitelist.

**Queries where the data is.** A reader's interaction re-runs only what depends
on it, and a query runs in the reader's own browser — on the same SQLite wasm and
functions, with no network — when the reader may hold everything it reads. The
server decides that per reader when it serves the page (`dataflow.hold` on the
island): an import is holdable when the reader may read the dataset's own rows
(not merely the document's results over them), it is a stored dataset rather
than a connected database, and it is under 50,000 rows and 5 MB. Its rows are
fetched once, by import name, through the same query door and read check as a
run (`{"hold":"<import>"}`), which decides again on every request. Everything
else — Postgres, anything downstream of it, the membership, data past the cap or
out of the reader's reach — runs on the server as before. A write to a held
dataset shows at once and the server decides; a refusal is rolled back.

Running the engine needs one more CSP source, `'wasm-unsafe-eval'`, on the app
page, the standalone `/raw` document and the offline file. It admits compiling
WebAssembly and nothing else — `eval`, `new Function` and string timers stay
refused — and it is never added to the author-script frames, where author code
runs. The wasm is fetched from this origin at a content-addressed `/story/`
URL (the `/raw` document's `connect-src` names that directory), cached
`immutable`; the offline file carries it inside itself.

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
