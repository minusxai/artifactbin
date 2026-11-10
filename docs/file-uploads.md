# File uploads

Upload original bytes with
`POST /api/artifacts?format=file&filename=scene.glb` with the bytes as the
body and a `Content-Type` matching the extension. The session equivalent is
`/api/my/artifacts`. JSON API callers can send
`{ "file": { "filename": "note.txt", "contentType": "text/plain", "base64": "SGVsbG8K" } }`.
JSON PUT uses the same file envelope to replace an existing file.

Accepted extensions are defined in `services/contracts/src/file-types.ts`:

| Category | Extensions |
|---|---|
| Video | mp4, webm, mov |
| Audio | mp3, wav, ogg, m4a, flac |
| 3D | glb, gltf, obj, fbx, stl |
| Images | png, jpg, jpeg, webp, gif, svg, avif |
| Documents/data | pdf, txt, csv, json, xlsx |
| Fonts | woff, woff2, ttf, otf |
| Archives | zip |

The final extension is case-insensitive and determines the stored MIME type.
Unsupported or missing extensions return HTTP 400 `unsupported_file_type`,
with an `allowed` list. Filenames cannot contain paths or control characters.
This checks the extension, not the internal file format. Original bytes are
preserved; accepting an upload does not provide a preview or format decoder.

The default per-file limit is 50 MB (`FILES__MAX_BYTES`). Raw requests are
bounded as they stream in. Existing artifact-count and stored-byte quotas also
apply. The response includes the artifact id, page URL, filename, contentType,
bytes and rawUrl. Account-owned files default to unlisted; private files retain
their normal read permissions.

Bytes live in content-addressed object storage. Downloads stream with
attachment disposition, a sandbox CSP and nosniff. The file page offers a
download; it does not interpret uploaded content.

Every image, PDF and file artifact records `meta.sha256`: the hash of the bytes
the client uploaded, taken before any optimisation, so an image's hash is that
of the file you sent and not of the stored WebP. Publication preflight uses it
to answer whether you already own a live artifact published from those exact
bytes, and the client then references that artifact instead of uploading the file
again. The lookup never crosses accounts: another owner's identical bytes and
artifacts merely shared with you are never returned.


## Dataset attachments in pages

Declare a live dataset link in native HTML and use the hosted upload component:

```html
<link rel="af-dataset" data-af-name="attachments" href="ref:DATASET_ID">
<af-file-upload dataset="attachments" multiple accept="image/png,image/jpeg,image/webp"></af-file-upload>
<script type="module">
import '@afbin/file-upload';
import {bindFileUpload} from '@afbin/apollo';
const binding=bindFileUpload(document.querySelector('af-file-upload'));
// Call binding.dispose() when removing this UI.
</script>
```

The platform adds the core script before author modules. The component's
`af-change` event carries `detail.value` (file metadata) and a reason of `upload`
or `remove`. Upload changes the selection only: persist the returned references
through your declared dataset's current write policy (a page's `sql` insert).
Removing a reference does not delete stored bytes.

For custom controls, `watchUploadContext` reports trusted upload availability;
`uploadFile(file,{dataset,signal,requestId})` returns the receipt. The signed-in
caller needs current insert authority. The server rechecks provenance, access,
file policy and grants; client `accept` and size limits only guide selection.
Retry an uncertain upload with the same File or explicit request ID; reusing the
ID for different bytes conflicts. Four pending uploads and 50 MB per request are
bounded at the native transport boundary. Archived readers, portable downloads
and raw pages without the trusted frame cannot upload.

The readable component contract is
`services/app/skills/artifactbin/components/file-upload.ts`; the native runtime
and datasets guides are served from the selected server at `/llms/runtime` and
`/llms/datasets`.
