---
name: html-uploads
description: Credential-free hosted dataset file uploads, durable retries, permissions and portable restrictions.
---
## Read first

[HTML components](html-components.md) and [HTML runtime](html-runtime.md).

## Contents

- [Hosted adapter](#hosted-adapter)
- [Permissions and retries](#permissions-and-retries)

## Hosted adapter

A hosted page may upload files to a linked live dataset through the trusted platform frame. Keep credentials out of page code. Declare the dataset normally:

```html
<link rel="af-dataset" data-af-name="attachments" href="ref:DATASET_ID" data-af-mode="live">
<af-file-upload dataset="attachments" label="Attachments" multiple accept="text/plain"></af-file-upload>
```

After registering the installed FileUpload component, bind the real platform adapter and picker availability:

```js
import {bindFileUpload} from '@afbin/apollo';
const control = document.querySelector('af-file-upload');
const binding = bindFileUpload(control, {helperText: 'Or drop files here.'});
// For caller-owned business rules: binding.setDisabled(true/false).
// When removing the view: binding.dispose();
```

`bindFileUpload` disables the chooser while the trusted session loads, when signed out, in archived/portable readers, or when its connection is unavailable. It sets ordinary `helperText` presentation (including “Sign in to upload files.”); it does not prove an insert grant. Account/connection changes cancel pending local completions. Keep caller disabled rules through `binding.setDisabled`; a recovered signed-in session restores your helper text. Dispose the binding when removing the view. Raw files without the trusted shell stay unavailable.

For a custom control, `watchUploadContext(listener)` immediately reports `{state,scope}` and returns `{unsubscribe()}`. Treat scope as opaque; it changes when the trusted session or served context changes. Never infer server permission from `signed-in`.

`uploadFile(file, {dataset,signal,requestId?})` returns the server's `{ref,url,name,contentType,size,replayed?}` receipt. The control stores metadata in its `value`; use `af-change` to keep controlled viewer state through `client`. An optional adapter `fileUrl` may resolve retained server URLs for previews. Never invent a receipt before the server accepts the file.

## Permissions and retries

The dataset link establishes provenance, not write permission. The signed-in caller needs current dataset insert authority. The platform pins the served document and live edit, and the server rechecks access, linked dataset provenance, file policy and grants before storing a receipt. Archived readers and portable downloads cannot upload. A raw page without its platform frame has no upload connection.

Each request is bounded to 50 MB; server policy may impose a lower limit. The bridge permits four pending uploads. `accept`, component limits and `disabled` are browser guidance; server checks remain authoritative.

Retry with the same `File` object to reuse its request ID. A caller may supply an explicit `requestId` (8–120 letters, digits, underscore, dot or hyphen) to recover an uncertain operation across a reload. Reusing an ID for different bytes or a filename is a conflict. The platform never retries automatically. Abort, disconnect or timeout stops the local wait; the server may already have committed. Recover using the same ID instead of creating another upload. Removing a reference from the control does not delete the stored file.
