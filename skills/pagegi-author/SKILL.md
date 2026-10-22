---
name: artifactbin-author
description: Write an Artifactbin page. It's a normal HTML file; keep viewer state in @afbin/apollo local state, and share data through backends.
---

# Author a Artifactbin page

A Artifactbin page is a normal HTML file. Write it the way you'd write any web page, with any scripts, styles and libraries. The platform adds saving, sharing, comments, presence, design systems and history on top.

## Installation

Install this skill with `npx https://app.artefactbin.dev/skills/artefactbin-skill.tgz` and restart your coding agent. This command only installs the skill; use the HTTP API and scripts below to author pages. For another server, install with `--origin https://your-server.example`. Credentials are stored separately per server origin; signing in to one server never signs you in to another.

## Core concept

A Artifactbin page is a normal HTML file with one extra line: the core script.

```html
<!DOCTYPE html>
<html>
<head>
  <script src="https://app.artefactbin.dev/af/v1/core.js"></script>
  <title>My Page</title>
</head>
<body>
  <h1>Hello</h1>
</body>
</html>
```

The core is what makes this a Artifactbin page. It provides the `@afbin/*` libraries (see Local state contract), and it adds saving, sharing, comments, presence and design systems around your page. Always include it, first in `<head>` before any other script, so it's ready before your code runs. (If a file arrives without it, the platform adds it there as a fallback.) When a page is downloaded, the platform inlines the core, the design system and the downloading viewer's local state, and records on the core tag which server the file came from and which version it is, so the file works on its own: opened from disk, its state is kept in that browser across reloads, and a small "Download page" button saves it again with its current state. Opened while that server is reachable, the file shows the same platform bar as the hosted page: it reads the page's comments, tells the viewer when the server has a newer version, and offers Connect, which signs the viewer in on the server, in a window of the server's own, never in the file. Connected, the viewer comments, sees who else is there, shares, and calls backends as they would on the hosted page, and the bar's "Download HTML" saves the file with its current state. Without the server, backend calls settle as `offline`. The file never holds an account token.

Don't build your own toolbar, comments, sign-in, dark-mode switch or design-system picker; the platform already provides them.

Don't add your own `<script type="importmap">`: the core adds the page's import map, and some browsers use only the first one, so import other libraries by their full URL.

## Local state contract

Keep viewer-specific state in local state, through `client` from `@afbin/apollo`: filters, the open tab, selections and drafts. Render shared backend data directly from `watchQuery` results. Don't keep state in plain variables.

Local state belongs to the viewer. It's saved in their browser, so it's still there when they come back, and other viewers never see it. To share data between viewers, use a backend (see Remote state contract).

Local state needs no schema or resolvers. Read it with a query, and write it back with `updateQuery`:

```html
<ul id="list"></ul>
<button id="add">Add</button>
<script type="module">
  import { gql, client } from '@afbin/apollo';

  const PRODUCTS = gql`{ products { id name price } }`;

  client.watchQuery({ query: PRODUCTS }).subscribe(({ data }) => {
    document.querySelector('#list').innerHTML =
      (data.products ?? []).map((p) => `<li>${p.name} — ${p.price}</li>`).join('');
  });

  document.querySelector('#add').onclick = () =>
    client.updateQuery({ query: PRODUCTS }, (data) => ({
      products: [...(data.products ?? []), { id: crypto.randomUUID(), name: 'Lamp', price: 40 }],
    }));
</script>
```

- Store plain data: strings, numbers, booleans, arrays and objects.
- A `<script type="application/json" data-af="state">` block in the page is where every viewer's local state starts. When you publish or save, the platform takes that block out of the saved file and keeps it as the page's starting state, so it is no longer in your copy; a download (`?download=1`) shows it again.
- A comment saves the commenter's local state, and a viewer can click another viewer in the toolbar to see their page, read-only. These saved views retain the rendered page and local state; keep viewer-specific controls in local state and shared results in backend watches.
- An address ending in `#af-state=<base64url of the state's JSON>` opens the page with that local state, which becomes the viewer's own. Comment contexts give such an address, so you can open exactly what the commenter saw.

Read [`references/state.md`](references/state.md) for two tabs of one viewer, changes that must combine, state in an address, and exactly what can be stored.

## Backend lambdas and resolvers

For server-side work, such as private data or external APIs, add a lambda: a TypeScript file with its schema and resolvers. Give the file an ID first:

```sh
node scripts/add.mjs backends/billing.ts backends/crm.ts
# backends/billing.ts  Bk7Qa2
# backends/crm.ts      Cr4mZ9
```

Then link each one from `<head>` by its ID, and give it a name:

```html
<link rel="af-backend" href="https://app.artefactbin.dev/af/v1/ids/Bk7Qa2" data-af-name="billing">
<link rel="af-backend" href="https://app.artefactbin.dev/af/v1/ids/Cr4mZ9" data-af-name="contacts">
```

Every Artifactbin file has one short ID (six letters and digits). A backend file's address is `https://app.artefactbin.dev/af/v1/ids/<id>`; linking by it keeps working if the file is renamed or moved, and two pages can link the same backend. On a page connected to a different server, the server rewrites the address to its own host on save.

A page's address, the `url` a publish returns, is `https://app.artefactbin.dev/a/<id>`. Anything after the ID and a hyphen is ignored, so `https://app.artefactbin.dev/a/<id>-<title>` opens the same page with a readable link. If your account has chosen a handle (`references/http-api.md`, Handle), a page with a path in your library also opens at `https://app.artefactbin.dev/@<handle>/<path>` (the path is the one `GET /api/paths` lists), until it is renamed or moved or the handle changes; share `url` when in doubt. `https://app.artefactbin.dev/af/v1/ids/<id>` opens any file by ID as well. Every form behaves the same: a private page asks a signed-out visitor to sign in, and anything unknown is 404.

A page can link any number of backend files. `data-af-name` is required and must be unique on the page; it's the namespace the page queries the file's fields under (see Remote state contract).

`backends/billing.ts` (`Bk7Qa2`):

```ts
import { gql } from '@afbin/apollo';

export const typeDefs = gql`
  type Invoice { id: ID!  total: Float!  paid: Boolean! }
  type Query { invoices: [Invoice!]! }
  type Mutation { pay(invoice: ID!): Invoice! @auth(role: EDITOR) }
`;

export default {
  Query: {
    async invoices(_args, principal, caps) {
      return caps.invoke({ resource: 'billing', operation: 'list', input: { customer: principal.subject } });
    },
  },
  Mutation: {
    async pay({ invoice }, principal, caps) {
      const [row] = await caps.invoke({ resource: 'billing', operation: 'pay', input: { invoice } });
      return row;
    },
  },
};
```

- Write the schema as if the file were alone. Its fields and type names are scoped to its namespace, so two files can both define `Invoice` or `list`.
- `principal` is the signed-in user; use it, not arguments, to know who's calling.
- `@auth` in the schema controls who can call a field.
- `caps` is how a lambda reaches its shared store (`caps.store`), databases and APIs.
- A lambda may import npm packages pinned to an exact version (`import postgres from 'postgres@3.4.5'`) and call public addresses with `fetch`; private addresses are refused. A call has 10 seconds.
- `publish.mjs` sends each linked backend file that is new or changed, under the ID it already has. There's no separate deploy step. Run `add.mjs` in the page's folder: it records each ID's file in `.af/ids.json`, which is how `publish.mjs` finds it.

Read [`references/backend.md`](references/backend.md) for access rules, the store, databases and APIs, and call outcomes.

### Secrets

A resolver's fourth argument, `env`, holds the account secrets of the lambda's owner: values such as an API key, stored once on the account, never written into a file. Set one from standard input with `printf '%s' "$STRIPE_KEY" | node scripts/secrets.mjs set STRIPE_KEY`, or on the Account page; `node scripts/secrets.mjs` lists the names. Then read it as `env.STRIPE_KEY`.

```ts
export default {
  Mutation: {
    async charge({ amount }, principal, caps, env) {
      return pay(env.STRIPE_KEY, amount);
    },
  },
};
```

- `env` belongs to the account that published the backend file, not to the page or the viewer calling it.
- Anyone who can open the page can call a field without `@auth`. A field that uses a secret to spend money or write anywhere must carry `@auth`, so only the viewers you mean can trigger it.
- Never return a secret from a resolver or put one in a page.

### Packages and the network

```ts
import postgres from 'postgres@3.4.5';

export const typeDefs = `type Query { count: Int! @auth(signedIn: true) }`;

export default {
  Query: {
    async count(_args, principal, caps, env) {
      const sql = postgres(env.DATABASE_URL, { max: 1, ssl: 'require' });
      try {
        const [row] = await sql`SELECT count(*)::int AS n FROM orders`;
        return row.n;
      } finally {
        await sql.end();
      }
    },
  },
};
```

- Write the exact version into every npm import. Publishing fetches each package from esm.sh, built for Cloudflare Workers, and refuses the file naming any package it can't fetch or bundle.
- A lambda reaches the public internet (`fetch`, and TCP for database drivers). Private and local addresses are refused, so a database needs a public address.
- `process.env` is empty; secrets are only in `env`.

Read the "Packages and the network" section of [`references/backend.md`](references/backend.md) for the details.

## Remote state contract

Data that viewers share lives in a backend. Every backend file has a built-in JSON store, `caps.store`, that the platform keeps for it: one document, shared by every viewer and page that calls the file. See [`references/backend.md`](references/backend.md).

Query a backend's fields under its `data-af-name`, with the same `client`:

```js
import { gql, client } from '@afbin/apollo';

const { data, errors } = await client.query({
  query: gql`{
    billing { invoices { id total paid } }
    contacts { search(q: "ann") { name } }
  }`,
});

const result = await client.mutate({
  mutation: gql`mutation Pay($id: ID!) { billing { pay(invoice: $id) { id paid } } }`,
  variables: { id: '42' },
});
```

- Local state lives at the top level, and each backend under its own name, so they never clash.
- In one mutation request, fields run in the order written, even across namespaces. Each field has its own outcome: one can succeed while another is rejected.
- Render backend results from `watchQuery` directly; they stay remote and authoritative. Keep only the viewer's filters, drafts and other local choices in `updateQuery`. Offline files need a connection for fresh backend data; comments and saved views retain an inert rendering of what the viewer saw.
- Write each query or mutation as one `gql` template. Don't insert one `gql` document into another; to fetch from several backends, put them all in the same template, as above.
- Remote calls can fail, or the page can be offline, so check `errors`. Each backend mutation field's outcome is in `result.extensions.outcomes`, keyed by its path, for example `{ "billing.pay": "committed" }`.
- `watchQuery` watches local fields and backend namespaces together. Server changes and reconnects refresh backend results automatically; no polling is needed. Subscribe to `{ data, errors }`; backend fields start as `null` until the first response and become `null` on a refused read. Unsubscribe when the view is removed. `updateQuery` works on local state only.
- If a mutation's outcome is unknown (for example the connection dropped), don't assume it failed and don't retry it automatically.

## File states

The platform sets these attributes on `<html>`, and keeps them current as the viewer changes them:

```html
<html data-af-dark="true" data-af-design-system="dossier">
```

| Attribute | Values |
|---|---|
| `data-af-dark` | `"true"` in dark mode; absent otherwise |
| `data-af-design-system` | `volta`, `phosphor`, `drafting`, `meridian`, `dossier`, `riso`, `almanac`, `redline`, `nocturne`, `broadsheet`, `signout`, `sorbet`, `arcade` |

To choose the page's default design system, set `data-af-design-system` on `<html>` in your file; without it the page uses `meridian`. Viewers can switch, and the core sets `data-af-dark` for them, so don't write it yourself.

The core adds the design system's CSS to the page for you. Don't add it yourself, and don't edit it.

It's a link to the design system's file:

```html
<link rel="stylesheet" href="https://app.artefactbin.dev/af/v1/design-systems/dossier.css" data-af="design-system">
```

When the viewer picks another design system, the core changes the link to that system's file.

The CSS defines standard variables, with light and dark values. Use them in your own styles, and the page follows whichever design system and mode the viewer picks:

```css
body { background: var(--background); color: var(--foreground); font-family: var(--font-sans); }
button { background: var(--primary); color: var(--primary-foreground); border-radius: var(--radius); }
.card { background: var(--card); border: 1px solid var(--border); }
```

Each design system's exact CSS is in `design-systems/<name>.css`. Each file opens with a short description, then lists every colour with its light and dark value and purpose, the standard variables, the fonts and the `.t-*` text styles.

## Header metadata

Page metadata lives in one JSON block in `<head>`. This is how you set or update the page's details. The platform controls how it's saved.

```html
<head>
  <script src="https://app.artefactbin.dev/af/v1/core.js"></script>
  <script type="application/json" data-af="meta">
  {
    "version": 5,
    "name": "My Page",
    "id": "Pg4mQ2"
  }
  </script>
</head>
```

Set `name` yourself. The platform writes `id`, `version` and `nextNodeId` (the counter it uses for new node IDs); leave those as they are.

When you publish or save, `scripts/publish.mjs` replaces your file with the page exactly as the platform saved it, with this block and every `data-af-id` filled in, so your copy matches the published page.

## Unique ID per node

Every element has a unique, stable `data-af-id`. The platform builds on this: comments, selections shared between viewers and history views all find elements by their ID. You build none of those features yourself.

For elements written in your HTML, add them without an ID and let the save (or `node scripts/check.mjs page.html --write-ids`) number them; keep the IDs already there, and never edit `nextNodeId` by hand. For elements your script creates, the platform can't see them when it saves, so set `data-af-id` yourself from the data:

```js
li.dataset.afId = 'product-' + p.id; // <li data-af-id="product-42">
```

Then a comment on product 42 stays on product 42, even after the list is re-sorted.

## Publishing and comments

Use the scripts. Sign in once with `node scripts/auth.mjs --email <address>`, then run it again with `--code <code>` from the email; the other scripts then use the saved token for `AF_SERVER` (default `https://app.artefactbin.dev`). If a harness set `AF_TOKEN` and `AF_SERVER`, skip signing in: the scripts use them instead.

```sh
node scripts/publish.mjs page.html                     # publish, or save your changes
node scripts/comments.mjs page.html                    # list comment threads
node scripts/comments.mjs page.html --context c1       # the page as the commenter saw it
node scripts/comments.mjs page.html --reply c1 --body "Fixed."
```

- **`publish.mjs`** replaces the file with the page exactly as saved, with the metadata block and every `data-af-id` filled in. If it can't tell whether a save worked, run it again: it resends the same request, which is applied at most once.
- **If someone else saved first,** `publish.mjs` merges their changes into your file and stops. Review the file and run it again. If your edits overlap theirs, it leaves your file alone and writes theirs to `page.remote.html` and both sides' changes to `page.conflict.diff`; combine them in `page.html` and run it again.
- **Keep the `.af/` folder** the scripts write next to the page, and don't edit it. It holds what the server last saved, so they can merge and retry safely.
- **Trash is recoverable:** deleting retains IDs, all versions and storage usage; use `GET /api/trash` and `POST /api/trash/:id/restore`. Links and page APIs stop working while trashed. See `references/http-api.md`.
- **Imported group pages retain their group owner:** active group editors can edit, share and delete them; viewers can read. Group membership never grants account secrets. Group backend files and execution are unsupported; see `references/http-api.md`.
- **New pages are unlisted:** anyone with the link can view them. To change that, see Sharing in `references/http-api.md`.
- **Keep the token out of the page.**

Read [`references/scripts.md`](references/scripts.md) for every flag (`--pull`, `--new`, `--force`, `--watch`) and exit code, and [`references/http-api.md`](references/http-api.md) for the HTTP API underneath, including sharing, paths and deployed backends.

## Check your page

Before handing a page over, run:

```sh
node scripts/check.mjs page.html
node scripts/shot.mjs page.html --width 390 --dark --out phone-dark.png
```

`check.mjs` reports mistakes with line numbers. `shot.mjs` saves a screenshot (it needs Chrome); look at it. Each script takes `--help`.

## References

Read these when you need them:

- `references/state.md`: local state in depth: reading, writing, two tabs of one viewer, changes that must combine, state in an address, what can be stored.
- `references/backend.md`: backend lambdas in depth: identity, `@auth` rules, the shared store, databases and APIs, deploying, outcomes.
- `design-systems/<name>.css`: one file per design system, with its description and the exact CSS the core loads.
- `references/http-api.md`: signing in, publishing and saving, comments, sharing, paths and deployed backends over HTTP.
- `examples/todo.html` with `examples/backends/todos.ts`: a complete shared todo list using everything above: the list in the backend's store, each viewer's filter and draft in local state.
- `examples/notes.html` with `examples/backends/notes.ts`: shared notes in a Postgres table, reached through two operations an operator connected to the page; the add form only for signed-in viewers.
- `scripts/auth.mjs`, `scripts/add.mjs`, `scripts/check.mjs`, `scripts/shot.mjs`, `scripts/publish.mjs`, `scripts/comments.mjs`, `scripts/secrets.mjs`: sign in, reserve IDs, check a page, take screenshots, publish and save, work with comments, manage the secrets your lambdas read as `env`. Read `references/scripts.md` for their flags. Need Node.js 20.10+; screenshots also need Chrome.
