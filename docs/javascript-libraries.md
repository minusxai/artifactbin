# Hosted JavaScript libraries

DOM-based libraries run inside a generic `<Sandbox>`, not the parent artifact
or its hidden Helmet script. `html` is a static HTML string for that realm;
`script` is its static JavaScript string. `title` labels the iframe and numeric
`height` reserves 100–4096 pixels (default 320); width follows its container.
The child owns its DOM/canvas, but cannot touch the parent, controls or cookies.
Parent Tailwind styles do not cross the frame; use CSS inside its HTML.
The sandbox's author API has two entry points:

```js
const THREE = await artifact.library('three');
const url = await artifact.resolve('ref:Abc123');
const model = await new THREE.GLTFLoader().loadAsync(url);
```

`library(name)` imports a platform-owned ES module, lazily and once per page.
`resolve(ref)` checks anonymous read access and returns a document-scoped URL.
The subsequent GET rechecks access. Private/deleted/missing assets are 404,
even for an owner; document permissions never confer asset access. A loaded
asset is not retroactively erased from a reader's memory.

## Adding a library

1. Install an exact npm **dev dependency** in `services/app/package.json`
   (`npm install --save-dev --save-exact <package>@<version> -w services/app`).
   The build bundles it into a static browser module; production does not need
   the original npm package.
2. Add an ESM wrapper under `services/app/lib/libraries/`. Export the public
   surface authors should receive, including any supported addons.
3. Add its name, npm package, exact version, and wrapper filename to
   `services/app/lib/libraries/registry.json`.
4. Run `npm run build:runtime`. The generic library build checks the version
   pin and bundles the wrapper's dependency graph into
   `/libraries/<name>-<version>/index.js`.
5. Add a browser gate proving it works under the artifact sandbox and in
   export. Packages that require workers, WASM, external assets or browser
   permissions need explicit support; a registry entry does not grant them.

The registry produces the author-facing URL map. Library code is absent from
the app and story entry graphs. Static modules have CORS for opaque-origin
documents; the sandbox and no-third-party policy remain in force. Asset fetches
use a path-exact `/a/<document>/resolve` CSP allowance, plus blob/data for
embedded buffers and textures. The resolver never accepts arbitrary URLs.

The first entry is Three.js 0.185.1 with OrbitControls and GLTFLoader. It
supports procedural scenes and self-contained GLBs, including embedded PNG
textures. External model dependencies and additional decoder workers are not
included. Authors own rendering, resizing, animation and GPU cleanup. Export
uses the existing bounded settling window; long asynchronous scene preparation
may exceed that window; there is no new scene-readiness protocol in this version.

The sandbox also receives the existing bounded `mx` data bridge: declared
signals, refreshes and named mutations. Persistent writes still pass current
ACL checks; a sandbox is not a write grant. No account/edit verbs or
arbitrary network destination are added. Replacing HTML/script replaces its
realm; removing it revokes the port. Local state resets on document reload.
Focus and pointer/touch input stay inside its visible bounds. Physical-device
keyboard/zoom and assistive-technology certification are separate rollout gates.

Migration: move the old Helmet DOM script to `Sandbox.script` and its target
canvas/HTML to `Sandbox.html`. Keep document data declarations in Helmet.
Code targeting arbitrary elements elsewhere in the artifact must be rewritten
using the declared data bridge, not granted parent DOM access. Sandbox content
is an atomic parent node for comments/editing; its internal HTML IDs belong to
the child realm, not the artifact node-ID namespace.

## File transport

`POST /api/artifacts?format=file&filename=scene.glb` accepts bytes with a supported extension; see [file uploads](file-uploads.md). The session twin is `/api/my/artifacts`. JSON/MCP accepts
`{file: {filename, contentType, base64}}`. Responses include the usual id and
URL, plus filename, contentType, bytes and rawUrl. Files can be replaced through
the existing JSON PUT flow, forked and shared like other artifacts.

Accepted extensions and MIME types live in `lib/story/file-types.ts`.
Files preserve bytes in content-addressed object storage. The raw upload is
bounded while reading (default 50 MB, `FILES__MAX_BYTES`), uses existing count
and byte quotas, and defaults to unlisted for account-owned uploads. Direct
downloads are streamed with attachment disposition, nosniff and a sandbox CSP.
The file page offers a download rather than interpreting arbitrary content.

Validation: `scripts/gate-libraries.mjs` uploads a textured GLB, verifies real
WebGL pixels and PNG export, checks lazy loading and repeated imports, and
confirms missing-reference and sandbox behavior.
