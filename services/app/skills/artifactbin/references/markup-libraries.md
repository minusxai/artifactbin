---
name: markup-libraries
description: "Libraries (Three.js), file uploads and script refs."
---
## Read first

Put canvas and scripts inside managed [Iframe](markup-iframe.md). Declare a
self-contained library bundle URL; it is cached through the asset pipeline.
Fetch public file bytes with `fetch('ref:<id>')`. Private assets never resolve.
Legacy Helmet DOM scripts and `artifact.library/resolve` calls must migrate;
those helpers are not exposed inside the isolated realm.

## Contents

Libraries · File uploads.

## Libraries


Any bundled HTTPS library URL can be declared as `<script src>`. The example
uses a self-contained hosted Three.js bundle with OrbitControls and GLTFLoader;
it goes through the same cache as a third-party CDN bundle, not a special exception.
Module dependencies must be bundled; relative imports and worker/decoder trees
are not packaged automatically. Managed external assets require the deployment's
asset hostname to be configured.

```jsx
<Iframe title="3D model" height={450}>
<style>{`canvas {width:100%;height:100%;display:block}`}</style>
<canvas id="scene" width="800" height="450" />
<p id="scene-status" role="status" />
<script id="three-bundle" type="module" src="[[ base ]]/libraries/three-0.185.1/index.js" />
<script>{`
(async () => {
  const THREE = await import(document.getElementById('three-bundle').src);
  const canvas = document.getElementById('scene');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, 800 / 450, 0.1, 100);
  camera.position.z = 4;
  scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 3));
  const bytes = await (await fetch('ref:Abc123')).arrayBuffer();
  const model = await new THREE.GLTFLoader().parseAsync(bytes, '');
  scene.add(model.scene);
  const controls = new THREE.OrbitControls(camera, canvas);
  function resize() {
    const width = canvas.clientWidth || 800;
    const height = canvas.clientHeight || 450;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    controls.update();
    renderer.render(scene, camera);
  }
  controls.addEventListener('change', () => renderer.render(scene, camera));
  const observer = new ResizeObserver(resize);
  observer.observe(canvas);
  resize();
  addEventListener('pagehide', () => {
    observer.disconnect();
    controls.dispose();
    scene.traverse(object => {
      object.geometry?.dispose();
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) if (material) {
        for (const value of Object.values(material)) if (value?.isTexture) value.dispose();
        material.dispose();
      }
    });
    renderer.dispose();
  });
})().catch(error => { document.getElementById('scene-status').textContent = error.message; });
`}</script>
</Iframe>
```

Replace `Abc123` with the uploaded file ID. Managed `ref:<id>` loads support
public uploaded files, images and PDFs; private, deleted and missing assets
are refused. A document's
visibility never grants access to its assets. Resolution is available after
publishing. An already-loaded asset remains in memory until the page releases it.

Start with self-contained GLBs, with textures embedded. Separate GLTF buffers,
relative file trees, external assets, Draco/KTX decoders and workers are not
bundled in this version. Browser WebGL support is required. Render the first
frame promptly for exports, and release controls, animation loops, textures,
geometry and the renderer on teardown.

## File uploads


Upload files with supported extensions, preserving the bytes and filename.
The extension determines the MIME type; unsupported extensions return
`unsupported_file_type` with the allowed list. The default
limit is 50 MB (self-host setting `FILES__MAX_BYTES`). Files count toward the
same stored-byte and artifact quotas as other assets.

```bash
curl -sS -X POST "[[ base ]]/api/artifacts?format=file&filename=scene.glb" \
  -H "Authorization: Bearer $ARTIFACTBIN_TOKEN" \
  -H "Content-Type: model/gltf-binary" --data-binary @scene.glb
```

Use `format=file` even for JSON or images when you want the original
bytes preserved. URL-encode the filename. Session uploads use the same shape
at `/api/my/artifacts`. JSON/MCP callers can send:

```json
{ "file": { "filename": "note.txt", "contentType": "text/plain", "base64": "SGVsbG8K" } }
```

The reply includes `id`, `rawUrl`, `filename`, `contentType`, and `bytes`.
The file's page offers a download; arbitrary formats do not get a custom
preview. Account-owned files default to unlisted, like other byte assets.
Private files remain private: author scripts always resolve them as not found.
Use `fetch('ref:<id>')` inside Iframe; see [managed assets](markup-iframe.md).

Accepted: mp4, webm, mov; mp3, wav, ogg, m4a, flac; glb, gltf, obj, fbx, stl;
png, jpg, jpeg, webp, gif, svg, avif; pdf, txt, csv, json, xlsx; woff, woff2,
ttf, otf; zip. Final extensions are case-insensitive; this does not inspect file contents.
