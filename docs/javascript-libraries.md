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
