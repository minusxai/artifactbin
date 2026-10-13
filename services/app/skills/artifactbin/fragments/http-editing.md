Edit the supplied artifact in place; do not publish scratch replacement documents:

1. `GET /api/artifacts/<id>`. Edit `markup`, preserving IDs. Keep this read’s `edit_id` and `version`.
2. `POST /api/artifacts/<id>/prepare`:

```json
{"source":"<edited markup>","edit_id":"<observed edit_id>","expectedVersion":<observed version>}
```

3. `POST /api/artifacts/<id>/edits`:

```json
{"edit_id":"<returned edit_id>","document_update":<returned document_update>}
```

Submit the prepared update unchanged. Preparation does not save. Reconcile 409s: [authoring]([[ references ]]http-authoring.md).
