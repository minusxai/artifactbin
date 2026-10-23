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

The runtime accepts a fixed import allowlist; arbitrary npm imports and network fetch are unavailable. Do not claim general network or secret access. Use only documented capabilities supplied to that resolver.

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
