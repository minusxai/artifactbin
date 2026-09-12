# File uploads

Upload original bytes with the CLI, which signs itself in on the connection it
already holds:

```bash
afbin push scene.glb
```

The HTTP surface underneath is
`POST /api/artifacts?format=file&filename=scene.glb` with the bytes as the
body and a `Content-Type` matching the extension. The session equivalent is
`/api/my/artifacts`. JSON API callers can send
`{ "file": { "filename": "note.txt", "contentType": "text/plain", "base64": "SGVsbG8K" } }`.
JSON PUT uses the same file envelope to replace an existing file.

Accepted extensions are defined in `services/app/lib/story/file-types.ts`:

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
bytes, and the CLI then references that artifact instead of uploading the file
again. The lookup never crosses accounts: another owner's identical bytes and
artifacts merely shared with you are never returned.
