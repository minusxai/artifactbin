---
name: markup-upload
description: Dataset attachments with FileUpload and page.upload.
---
# Dataset attachments

Attachments: `<FileUpload dataset="attachments" value="$refs" multiple
accept="image/png,image/jpeg,image/webp" label="Screenshots" busy="$uploading"
maxFiles={5} />`. Declare the dataset Import, `refs` as a string Value default
`"[]"`, and `uploading` as boolean default `false`, both `url={false}`. Single
uploads use a nullable string ref; multiple uses JSON array refs in the string.
The control uploads bytes, sets refs, and offers preview/remove/retry; Save is a
separate Mutation guarded while uploading. Removing a ref keeps stored bytes.
Author scripts use `page.upload(importName, File)` and
`page.fileUrl(importName, ref)`; uploads require a signed-in reader.

