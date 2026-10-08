---
name: markup-upload
description: Dataset attachments with FileUpload and page.upload.
---
## Read first

Declare the stored dataset as an `<Import>` and bind a string Value to
`<FileUpload>`. It uploads immediately and updates the Value with the attachment
refs; saving a row is a separate `<Mutation>`.

```jsx
<Import name="attachments" src="ref:abc123" />
<Value name="files" type="string" default="[]" url={false} />
<Value name="uploading" type="boolean" default={false} url={false} />
<FileUpload dataset="attachments" value="$files" multiple
  accept="image/*,application/pdf" label="Receipts" busy="$uploading" maxFiles={5} />
```

For one file, bind a nullable string Value without `multiple`. For multiple
files, the Value is a JSON array of refs encoded as a string. `accept` guides
the picker; the server checks every uploaded file. Uploads require a signed-in
reader and an insert grant for this document on the stored dataset. The control
shows previews for images, download links for other files, errors, and retry
and remove actions. Disable the form's Save action while `$uploading` is true;
the upload itself does not run a mutation.

The Helmet script can use the same transport directly:

```js
import { upload, fileUrl } from 'page';
const result = await upload('attachments', file); // File from an input
setFiles(JSON.stringify([...refs(), result.ref]));
const previewOrDownload = fileUrl('attachments', result.ref);
```

The upload writes bytes to object storage and records its object key and
metadata in the dataset's attachment store. The returned `ref` identifies that
record; a Value or dataset row only points to it. Store the ref, not the URL, as
the identity. Removing a ref from a Value or row removes that link only; it
does not delete the object or its attachment record. The dataset continues to
own and count the stored object against its quota. Reads through `fileUrl` are
checked against the current document and dataset access each time.

For older saved scripts that use `uploadImage` and `imageUrl`, see the
[compatibility note](dataset-images.md). New scripts should use this API.
