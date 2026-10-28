`POST /api/artifacts` with your bearer and `Content-Type: application/json`:

```json
{"dataset":"name,amount\nExample,12","title":"Example dataset","visibility":"unlisted","destination":{"type":"personal"}}
```

`dataset` accepts raw CSV text, JSON rows, or a catalog definition. CSV goes inside the JSON field, not a multipart upload. The response returns the new `id` and `url`; import `ref:<id>` in the document. Optional top-level `columns` declares types. See [catalogs](databases.md) for stored-table policies and connections.
