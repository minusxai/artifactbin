# Backend lambdas in depth

## The file

A lambda is one TypeScript file, linked from the page with a required `data-af-name`. A page can link any number of them. It exports `typeDefs` and a default object of resolvers. It may import `@afbin/apollo`, npm packages pinned to an exact version, and Node built-ins such as `node:crypto` (see Packages and the network).

`typeDefs` must be a plain string, or a `gql` template with no `${…}` inside it. The platform reads the schema without running your code.

## Who is calling

Every resolver receives `(args, principal, caps)`. `principal` is `{ tenant, subject }`, verified by the platform: `tenant` is the page's ID and `subject` is the signed-in viewer, or `null` for a viewer who isn't signed in. Use it to decide what the caller may see or do. Never trust a user ID or document ID passed in `args` as proof of identity.

## Access rules

Add `@auth` to a field to control who can call it. The platform checks it before your resolver runs:

| Rule | Who can call |
|---|---|
| `@auth(signedIn: true)` | Any signed-in viewer |
| `@auth(role: VIEWER)` | Anyone who can view the page |
| `@auth(role: EDITOR)` | Anyone who can edit the page |
| `@auth(role: OWNER)` | The page owner only |

A field without `@auth` can be called by anyone who can open the page.

## The store

Every backend file has one JSON document that the platform keeps for it: `caps.store`. Use it for data that viewers share, such as a list everyone adds to. It needs no setup. Every page and viewer that calls the file uses the same document.

- `await caps.store.get()` returns `{ value, version }`: the document, or `null` if nothing was saved yet, and its version (`0` before the first save).
- `await caps.store.set(next, { expected: version })` replaces the document with `next` and returns the new version, but only if the document is still at `expected`. If someone saved in between, it throws an error with `code: 'conflict'`, and nothing is saved.
- On a conflict, read again, redo the change on the new value, and save again:

```ts
async function change(caps, update) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const { value, version } = await caps.store.get();
    const next = update(value ?? { todos: [] });
    try {
      await caps.store.set(next, { expected: version });
      return next;
    } catch (error) {
      if (error.code !== 'conflict') throw error;
    }
  }
  throw new Error('Busy; try again');
}
```

- The document is plain JSON, up to 60 KB.
- Anyone who can call a field can reach the store through it, including viewers who aren't signed in. Use `@auth` on the fields that change it if only some viewers may.
- `examples/backends/todos.ts` is a complete example.

## Databases and APIs

`caps` reaches databases and APIs through named operations that an operator has connected to this page:

```ts
const rows = await caps.invoke({ resource: 'records', operation: 'save', input: { value } });

await caps.transaction('records', [
  { operation: 'save', input: { value: 'a' } },
  { operation: 'list', input: null },
]);
```

A transaction groups operations on one database. It can't include the store or other resources. If a call reaches the database but its outcome is unknown, don't retry it automatically. Viewers who aren't signed in can't reach databases or APIs.

`examples/backends/notes.ts` with `examples/notes.html` is a complete example: a page's notes in a Postgres table, read and written only through the `listNotes` and `addNote` operations an operator configured, with the page's ID bound as the tenant by the platform.

## Secrets

Every resolver receives a fourth argument, `env`: the account secrets of the lambda's owner, by name. A secret is a value such as an API key or a connection string that you store once on your account; it is never written into a backend file or a page, and never shown again after it is saved.

```ts
export default {
  Query: {
    async balance(_args, principal, caps, env) {
      const response = await fetch('https://api.example/balance', {
        headers: { Authorization: `Bearer ${env.API_KEY}` },
      });
      return (await response.json()).balance;
    },
  },
};
```

Store secrets with the script (the value comes from standard input, so it never appears in a command line or a shell history line as an argument) or on the Account page of the server's home page:

```sh
printf '%s' "$API_KEY" | node scripts/secrets.mjs set API_KEY
node scripts/secrets.mjs            # lists names and when each was set; never values
node scripts/secrets.mjs remove API_KEY
```

- Names are a capital letter, then up to 63 capitals, digits and underscores (`API_KEY`, `DB_URL`). Values are 1 to 4096 bytes of text without NUL (U+0000). An account keeps up to 64.
- `env` is the owner's: the account that published the backend file. A page that links someone else's backend gives that backend its own owner's secrets, never the page owner's and never the viewer's. A lambda whose owner has no secrets gets `{}`.
- A changed secret reaches the next call; there is nothing to republish.
- Anyone who can open the page can call a field without `@auth`, including viewers who aren't signed in. A field that uses a secret to spend money, send a message or write anywhere must carry `@auth` (`signedIn: true`, or a role), or any visitor could trigger it.
- Never return a secret from a resolver, log it, or write it into the store: everything a resolver returns reaches the viewer's browser.
- The server encrypts secrets at rest and only ever answers with names and times; the HTTP routes are in `references/http-api.md`.

## Packages and the network

Import any npm package by its exact version, written into the import:

```ts
import postgres from 'postgres@3.4.5';
import Stripe from 'stripe@17.3.1';
import { createHash } from 'node:crypto';
```

- The version is required and must be exact (`pg@8.13.1`, not `pg` or `pg@^8`): the file alone says which code runs. A file with an unpinned import is refused at publish with the fix in the message.
- Publishing fetches each package from [esm.sh](https://esm.sh), built for Cloudflare Workers, and bundles it into the lambda. If a package can't be fetched or bundled, the publish is refused naming it. Packages meant for Workers or the browser work best; packages that need native code, the file system or child processes don't work.
- `node:` built-ins are the ones Cloudflare Workers provides. `process.env` is always empty: secrets are only in `env`.
- A lambda reaches the public internet with `fetch`, and TCP with `connect()` from `cloudflare:sockets` (which database drivers such as `postgres` and `pg` use). Private and local addresses (`10.*`, `172.16-31.*`, `192.168.*`, `127.*`, `169.254.*`, and any name that resolves to one) are refused: the call throws at once. A database must have a public address to be reached this way, and should require TLS.
- A lambda opens a fresh connection on each call; keep connection pools small (`max: 1`) and close them before returning.

```ts
import postgres from 'postgres@3.4.5';

export const typeDefs = `
  type Order { id: ID!  total: Float! }
  type Query { orders: [Order!]! @auth(signedIn: true) }
`;

export default {
  Query: {
    async orders(_args, principal, caps, env) {
      const sql = postgres(env.DATABASE_URL, { max: 1, ssl: 'require' });
      try {
        return await sql`SELECT id, total FROM orders WHERE owner = ${principal.subject}`;
      } finally {
        await sql.end();
      }
    },
  },
};
```

A field without `@auth` can be called by anyone who can open the page, including viewers who aren't signed in. That includes every field that spends money, sends a message, or reads or writes with one of your secrets: put `@auth` on each of them.

## Running

A call has 10 seconds, counted from when it starts, and 256 MB of memory. Every call runs in an isolated environment that the platform keeps warm for a short while, so calls to the same backend file and version often share one and run quickly, including when several pages link that file. Separate backend files and owners never share an environment, even with identical code and secrets. As in Cloudflare Workers, a module variable may still hold its value on the next call, or may be gone: the environment is dropped after a while idle, after a failed call, and on every publish, and two calls can land in different ones. Never rely on module variables between calls: keep anything that must last in the store or a database, and never keep one caller's data in a module variable where another caller's call could read it.

The platform runs eight calls at a time across all pages; a call arriving while all eight are busy waits briefly (about two seconds) for a turn and is only then refused with `backend_busy`, so a page should retry that code rather than report it.

## Publishing

Link each file from the page with `<link rel="af-backend" href="…" data-af-name="…">`. Publishing the page publishes its linked files with it, and each file gets a version tied to that page revision. Every viewer who can open the page can call its backends, signed in or not, with no approval step; use `@auth` to limit who may call a field.

## Outcomes

A mutation sent to a backend settles as one of:

- `committed`: it succeeded.
- `rejected`: it was refused before running, for example by `@auth`.
- `offline`: the page couldn't reach the server, so nothing was sent.
- `unknown`: it was sent, but no answer came back, or your resolver threw after it started. It may or may not have happened; check before trying again.

The page reads each field's outcome from `result.extensions.outcomes`, keyed by its path, such as `billing.pay`.

A field that failed in the platform keeps the error message "Backend execution failed" (or "Backend request rejected before execution") and says why in the error's `extensions.code`:

| `extensions.code` | Outcome | Meaning |
|---|---|---|
| `backend_rejected` | `unknown` | Your resolver threw, or returned something that isn't plain JSON. Both are true at once: the code is `backend_rejected` and the outcome is `unknown`, because the resolver ran and may have changed something before it failed. |
| `store_limit` | `rejected` | `caps.store.set` was given a document over 60 KB and the resolver didn't catch the error. Nothing was saved, so the error keeps the "rejected before execution" message even though the resolver ran. |
| `deadline` | `unknown` | The resolver ran out of time (10 seconds). |
| `memory_limit` | `unknown` | The resolver ran out of memory (256 MB). |
| `backend_busy` | `rejected` | Every slot stayed busy for the whole wait; nothing ran. Try again. |
| `backend_unavailable` | `rejected` or `unknown` | The platform could not run backends just then. Try again later. |

When the caller is the page's owner, the error also carries `extensions.detail`: the first line of what the backend said (for `backend_rejected`, the thrown error's message), at most 200 characters, never source or a stack. Everyone else gets the code alone, so a page must not rely on `detail` being there.

### Registered dataset mutations

A backend with a server-registered dataset operation can call `await caps.dataset.mutate({ operation: "rename", requestId, params: { name: "Updated" } })`. The operation name selects a saved SQL operation tied to this backend version and page revision. The request contains no SQL, dataset identity, caller identity or policy. Parameters are named JSON scalars; reserved policy parameters cannot be supplied. Use a stable request ID of 16–128 letters, digits, underscores or hyphens for retries of the same operation and parameters.

The result contains `affected`, `rowCount`, `version` and `generation`. Repeating the same request returns its committed receipt after current access is checked. Missing registrations, revoked access and stale page revisions are denied. A concurrent row change may return `dataset_changed`; refresh authoritative data before another attempt. Successful writes preserve prior dataset versions and notify pages with current live bindings.

Compiled dataset controls keep an unresolved save's request ID and scalar arguments in the viewer's canonical local document before sending. Reload restores it as unknown and never sends automatically. Explicit reconciliation uses the original ID and arguments, only with the same freshly verified caller partition and immutable operation registration. A changed caller or page/backend revision leaves the record blocked. Confirmed receipts clear it; if local clearing fails, later reconciliation asks for the same receipt. Unavailable durable browser storage refuses the shared save before sending. Clearing browser data also removes local recovery records.

A backend registered to the current page can call `await caps.dataset.members()` to read its accepted membership joins. It takes no arguments and returns `{ generation, rows }`, where each row has `user_id` and an ISO `joined_at`. This is the current page's membership relation, not a directory or list of ACL shares. The platform rechecks page access and the saved backend binding on each call; unavailable or changing authority refuses the read. Results are bounded to 10,000 rows and the dataset response size limit.

A backend with a registered person selection can call `await caps.dataset.person({ valueName: "selectedPerson", userId })`. The value name selects the saved user-column binding; the requested ID must occur in its current policy-filtered rows. The result is `{ name, handle, image }` or `null`, with fresh access and snapshot checks. This is not a user directory: callers cannot choose a page, dataset, column or source namespace, and the result never includes credentials or email.
