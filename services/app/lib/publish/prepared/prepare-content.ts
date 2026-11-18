import { objectStore, prepareObjects, recordObjectWrites, type PreparedObject } from '@/lib/object-store';
import { json } from '@/lib/http';
import { parseContentInput, type ContentInputCtx } from '../document/input';
import type { StoredContent } from '@/lib/document';

export interface PreparedContent {
  content: StoredContent;
  objects: PreparedObject[];
}
type PreparationContext = Omit<ContentInputCtx, 'objects'>;

/** No publication effects: bytes live only in this request's private plan. */
export async function prepareContentInput(body: Record<string, unknown>, ctx: PreparationContext = {}, options: {allowRemoteInputs?: boolean} = {}): Promise<PreparedContent | Response> {
  if (!options.allowRemoteInputs && ['sheetUrl', 'csvUrl', 'imageUrl', 'pdfUrl'].some(key => body[key] != null)) {
    return json({error: 'dry_run_unsupported', details: ['Remote imports require publication. Download the source locally and push the file to validate it without importing.']}, 400);
  }
  const staged = prepareObjects({get: key => objectStore().get(key)});
  const content = await parseContentInput(body, {...ctx, objects: staged.store});
  if (content instanceof Response) return content;
  return {content, objects: staged.objects};
}

/** The only persistent half of a prepared publication. */
export async function applyPreparedContent(prepared: PreparedContent): Promise<StoredContent> {
  const {content} = prepared;
  // Together: inside a transaction these puts are its idle time (the pool's idle_in_transaction_session_timeout).
  await Promise.all(prepared.objects.map(object => objectStore().put(object.key, object.bytes, object.contentType)));
  return content;
}

/**
 * The persistence of a publication: records its keys for the object sweep now (a committed statement, so call it
 * before the publishing transaction opens) and returns the puts, which run as that transaction's last step. A
 * publication refused or failed inside the transaction therefore stores nothing.
 */
export async function preparedPersistence(prepared: PreparedContent): Promise<() => Promise<StoredContent>> {
  await recordObjectWrites(prepared.objects.map(object => object.key));
  return () => applyPreparedContent(prepared);
}
