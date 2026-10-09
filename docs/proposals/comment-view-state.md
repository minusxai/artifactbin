# Native comment view state

A comment keeps its existing source anchor, quote, range and revision. Optional
`view_state: {v: 2, state: {...}}` records the page state that determines its view,
captured from one document-local registry (`lib/story-runtime/comment-state`).
Nothing is opted in by hand. Static pages register nothing and keep the existing
behavior. Context is bounded JSON (32 KiB, 256 keys), persisted on the annotation
under its existing ACL.

What registers, and under which key:

- `$`: the declared scalar Values the link carries (`url={false}` excluded), as one
  `{name: value}` object (`lib/islands/boot`). Restore is one `store.setValues`.
- `<node id>:value`, `<node id>:open`: an uncontrolled kit `Tabs`, `Accordion`,
  `Collapsible` or `Dialog`, under the source element's own id. A control bound to
  a Value is that Value.
- `<mount id>:<name>`: a script's `createSignal(value, {name})` inside an exported
  component, scoped by the node its component mounts at (`MountScope`,
  `lib/islands/comment-state`); `<name>` alone at module level. The script's
  `solid-js` passes through a build-time shim (`author-module.server`) whose
  `createSignal` is the runtime's, so the author API is Solid's own signature.

The document runtime freezes the registry when a comment target is picked. Native
comments carry it through their existing transport. When a thread opens (or its
Restore saved view button is pressed), the runtime restores it before locating,
highlighting and scrolling to the target. Routine geometry/hover updates never
restore it again. Restore sets what is live and stays pending until the thread
closes, so a screen the restore mounts seeds its own signals as they register.
Keys the page no longer has are ignored; a part that refuses its value shows a
message in the existing thread, retaining the discussion and screenshot. A live
duplicate key warns and the last registration wins.

The author runtime and frame editor are independently bundled. The registry is
attached to the document through a versioned symbol, so both bundles share it.
No callbacks or executable state cross the authenticated frame channel.

Scope: registered keys, not arbitrary JavaScript memory, unnamed signals, backend
data, focus, scroll containers, transient hover state or animation time. Restores
run against the current artifact; archived-version playback is future work. An
element written anew gets a new id, so its saved state goes with the old one.
