# JavaScript libraries

Native HTML documents use ordinary browser ES modules. Import hosted libraries
through their `@afbin/` specifiers; the core runtime installs the import map before
author modules. The served author references document the supported chart, map,
diagram and component APIs. These imports do not use a JSX compiler or a managed
island runtime.

External module URLs must satisfy the document's declared CSP and reader consent.
Publishing does not automatically bundle arbitrary npm packages or make external
URLs available offline. Keep account credentials out of browser code. See
[serving and security](serving-and-security.md) and the served `/llms/runtime` guide.

## Page state

`@afbin/zustand` is pinned Zustand's vanilla entry (`createStore` …). `@afbin/state` exports `state`, a
Zustand vanilla store (`getState`, `setState(partial | fn)`, `subscribe`) of the viewer's saved page state:
it is the state block's defaults with the viewer's saved overrides merged over them (see
[document format](document-format.md)), persists per viewer in browser storage
(Zustand's `persist` middleware over the runtime's compare-and-swap document), follows the viewer's other
tabs, is seeded by `#af-state=` links and is what comment views snapshot. It is the same document
an older page's `@afbin/apollo` local fields read and write. Values must be storable JSON (`setState` throws a
`TypeError` otherwise); a `setState` that loses a race with another tab is applied again to the newer
document. Downloaded copies embed the module and keep their own viewer's state in that file's browser storage.
Both modules load only when a page imports them (`@afbin/apollo` imports `@afbin/state`).
