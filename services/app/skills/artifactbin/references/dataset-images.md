---
name: dataset-images
description: Upload and display screenshots attached to dataset rows through page scripts.
---
# Dataset screenshots

A signed-in reader can upload an image to a stored dataset import that grants
this document permission to insert. Import the helpers from `page`:

```js
import { uploadImage, imageUrl } from 'page';
const result = await uploadImage('feedback', file); // declared import name and File
setScreenshot(result.ref);                         // scalar dimg: reference
const preview = imageUrl('feedback', result.ref);  // dataset-scoped URL
```

Save the returned `dimg:` string through the ordinary declared `<Mutation>`.
The scoped URL checks current document and dataset read access whenever the
browser loads it. The dataset policy must allow `insert` for this document;
update or delete grants alone do not permit uploads. Uploads have a per-file
size bound and a finite per-dataset storage limit. Retrying with the same `File`
reuses its operation key; choosing another file starts a new upload.

Give the file input an accessible label and show busy or error state. Keep the
selected screenshot previewable and let the reader remove it before submitting
its scalar reference with the rest of the form. The regular mutation remains
the commit point for the feedback row.
