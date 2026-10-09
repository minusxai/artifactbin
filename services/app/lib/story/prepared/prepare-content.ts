import { objectStore } from '@/lib/object-store';
import { json } from '@/lib/http/http';
import { parseContentInput, type ContentInputCtx } from '../document/input';
import type { StoredContent } from '@/lib/document/stored-content';
import { prepareObjects, type PreparedObject } from '@/lib/object-store/prepared-objects';

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
  for (const object of prepared.objects) await objectStore().put(object.key, object.bytes, object.contentType);
  return content;
}
