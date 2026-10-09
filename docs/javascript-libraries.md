# JavaScript libraries

The document's Helmet `<script>` imports a library directly, by npm name
(`import * as THREE from 'three'`, resolved at publish to `https://esm.sh/three`)
or by full https URL; the agent skill teaches this in `references/markup-scripts.md`.
The script runs in the document itself (lib/islands/page-runtime) as a module built at
publish (lib/author-script/author-module.server), so a library needs no registry,
no pinned bundle and no managed frame. The document's CSP decides which hosts a
script may load from; see docs/serving-and-security.md.
