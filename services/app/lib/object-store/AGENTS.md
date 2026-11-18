# The object store

Where artifact bytes live (`index.ts`): put/get/getStream/delete on a key, on S3 (`S3_URL`) or the local
filesystem, behind one read cache. The database is the only index: every key the app reads comes from a row, and the
store is never listed (the S3 user has no ListBucket). `sweep.ts` deletes what no row references any more.

## Rules
- Write through `objectStore()`, never a bare `createS3Store`/`createLocalStore`: its puts of the swept kinds
  (`dataset/`, `image/`, `pdf/`, `file/`) record the key in `object_writes` first, with `due_at` a safety margin
  (24 h) ahead. A put inside a transaction cannot record (PGLite has one connection): record before the transaction
  opens and put as its last step (lib/publish `preparedPersistence`), so a refused write stores nothing. Such puts
  are few (one per table or file) and must finish within the pool's `idle_in_transaction_session_timeout` (30 s);
  reads of those bytes before then are served from the request's staged copy (`readingPrepared`).
- The sweep never deletes an object a concurrent write is about to reference. Keys are content-addressed (a write
  may reuse an old orphan's key) and the local store keeps an identical file's old mtime, so object timestamps prove
  nothing; the argument is the row. A write commits its `object_writes` upsert before its put; the sweep scans for
  references to due keys, then deletes the unreferenced ones in one transaction holding their rows FOR UPDATE and
  rechecking `due_at` there, object before row. So the write's upsert either commits before that recheck (the key
  is young and skipped) or waits for the sweep and then inserts a fresh row before its put re-creates the object. A
  write references its object within seconds of recording it, far inside the margin, so a key due when the scan
  ran has its reference, if any, committed and seen by it.
- "Referenced" is the key's text in any column of any row of any app table (`TABLES`), every version included:
  wider than the readers' columns on purpose. A false "referenced" keeps bytes; a false "unreferenced" loses them.
  A kind joins the swept list only once every put of it goes through `objectStore()` and every reader takes its
  key from an app-table row; never sweep runtime assets, avatars, comment images, web assets or exports here.
- Export images expire in lib/export (`expireExportImages`): unpointed by any cache row and replaced a day ago; a
  produced image whose publish certainly wrote no row is deleted at once. lib/runtime runs both, bounded, every 6 h.
- One database per store root: two installations sharing a bucket prefix would share keys, and each sweeps alone.
- Limits: objects written before `object_writes` existed are never candidates (finding them needs listing the store);
  a fork copies keys without a put, so a fork racing a test-user erase of its source could lose that source's bytes.

## Checks
- `npm test -- --files services/app/lib/object-store/__tests__/sweep.test.ts services/app/lib/object-store/__tests__/store.test.ts services/app/lib/export/__tests__/export-cache.test.ts services/app/lib/publish/__tests__/content-preparation.test.ts`
  (S3 cases run when `TEST_S3_URL` names a MinIO.)
