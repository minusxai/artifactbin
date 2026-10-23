---
name: html-backends
description: Paired TypeScript resolver files, immutable namespaces, per-backend stores and trusted account roles.
---
## Read first

Shared app state belongs in a backend file, not top-level page state. A backend is a separately published immutable TypeScript version with its own platform-kept store. Link it by name:

```html
<link rel="af-backend" data-af-name="garden" href="./garden.ts">
```

Publish the HTML with `backendSources:{"garden":"<complete garden.ts source>"}`. The namespace name must match exactly. The filename is an authoring reference; browsers never fetch or execute this backend file. Older page versions retain their backend bindings.

## Resolver contract

Export GraphQL `typeDefs` and a default object of root field resolvers. Each resolver receives `(args, principal, caps)`:

```ts
export const typeDefs=`
 type Query { count:Int! }
 type Mutation { increment:Int! @auth(role:EDITOR) }
`;
export default {
 async count(args,principal,caps){
  const {value}=await caps.store.get();
  return value?.count??0;
 },
 async increment(args,principal,caps){
  const {value,version}=await caps.store.get();
  const count=(value?.count??0)+1;
  await caps.store.set({count},{expected:version});
  return count;
 }
};
```

`caps.store.get()` returns `{value,version}`. `caps.store.set(value,{expected:version})` writes by compare-and-swap and returns the new integer version. A stale write throws a conflict; read current state and reconcile the intended action. Do not blindly replay an increment after an uncertain result. Use request IDs in application state when an action needs durable deduplication.

The runtime accepts a fixed, server-bundled import allowlist; arbitrary npm packages and Node built-ins are unavailable. Prefer import-free resolvers. Do not claim general network or secret access.

For public external data, `await caps.fetch("https://public.example/data.json")` performs a public HTTPS GET. It accepts only a URL: no custom headers, authentication, request body or method. DNS is pinned to the connection; private and metadata addresses are refused, including after each redirect (at most three). Requests have a three-second deadline and a 256 KiB response limit; currently only HTTP 200 is accepted. The frozen response exposes `ok`, `status`, `url`, `headers["content-type"]`, `text()` and `json()`. Handle refusal or timeout in the resolver; it is not a general-purpose authenticated HTTP client.

## Account identity and roles

The platform supplies a frozen trusted `principal:{tenant,subject}`: tenant is the page ID; subject is the authenticated account ID or null. Never authorize from a page-provided identity or a typed name. `@auth(signedIn:true)` requires an account. `@auth(role:VIEWER|EDITOR|OWNER)` enforces the original artifact role; comment-only access maps to VIEWER. Gate privileged mutations in the schema as well as presenting appropriate UI.

A readable page is not permission to write its linked datasets. Store namespaces and versions are platform-controlled; the page cannot forge backend IDs or select another page’s store.

## Query and schema discovery

From a page:

```js
const result=await client.query({query:gql`{garden{count}}`});
const changed=await client.mutate({mutation:gql`mutation {garden{increment}}`});
```

Direct authenticated clients use `GET /api/artifacts/ID/graphql?revision=VERSION` for `{sdl,revision}`. Run `POST /api/artifacts/ID/graphql` with `{"revision":"VERSION","query":"query {garden{count}}","variables":{}}`; omit optional variables/operationName when absent. Query the schema for the saved page version being used. GraphQL errors and permission refusals are failures, not successful results.

The shared-app example keeps tasks in the backend store and a display preference in viewer-local Apollo state. Check it as an editor and a viewer; viewers must not be able to run the editor mutation.

## Owner secret bindings

A backend can declare `export const secretBindings = ['API_TOKEN']` and read a
configured value with `await caps.secrets.get('API_TOKEN')`. Names must be unique
uppercase identifiers (at most 32 names, each at most 64 characters). Values are
never published in HTML, source, immutable metadata or downloads. Each value is
encrypted separately for that backend file and its owner.

Using the original authenticated session or bearer token, the owner configures
`/api/my/backends/BACKEND_ID/VERSION/secrets`: `PUT {"name":"API_TOKEN","value":"…"}`
sets or rotates a value; `DELETE {"name":"API_TOKEN"}` revokes it; `GET` lists
configured names only. Responses never include values. Other page editors cannot
configure owner credentials. A published version must declare the name; missing
or revoked bindings fail. Rotation and revocation take effect on the next read,
including for older published versions. Never return credentials from resolvers
or write them into shared state. Platform receipts and events redact literal
values read during that run; this does not prevent owner-authored network leaks.

Forking an HTML page copies its immutable backend code and schema into new backend identities owned by the copy. Each copied backend starts with an empty store (`value: null`, revision `0`); source store contents and owner credential bindings are not copied. Initialize defaults when reading an empty store. Dataset links keep their live or pinned mode and require the copy owner's current dataset access; forking does not grant dataset access.
