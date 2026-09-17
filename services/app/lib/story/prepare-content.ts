import { objectStore } from '@/lib/object-store';
import { json } from '@/lib/http';
import { parseContentInput, type ContentInputCtx, type StoredContent } from './input';
import { applyPreparedJsx, prepareJsx, type PreparedMarkup } from './jsx-tier';
import { prepareObjects, type PreparedObject } from './prepared-objects';

export interface PreparedContent {
  content: StoredContent;
  objects: PreparedObject[];
  markup?: PreparedMarkup;
}
type PreparationContext = Omit<ContentInputCtx, 'objects' | 'importAsset' | 'resolveFont' | 'prepareMarkup'>;

/** No publication effects: bytes live only in this request's private plan. */
export async function prepareContentInput(body: Record<string, unknown>, ctx: PreparationContext = {}, options: {allowRemoteInputs?: boolean} = {}): Promise<PreparedContent | Response> {
  if (!options.allowRemoteInputs && ['sheetUrl', 'csvUrl', 'imageUrl', 'pdfUrl'].some(key => body[key] != null)) {
    return json({error: 'dry_run_unsupported', details: ['Remote imports require publication. Download the source locally and push the file to validate it without importing.']}, 400);
  }
  const staged = prepareObjects({get: key => objectStore().get(key)});
  let markup: PreparedMarkup | undefined;
  const content = await parseContentInput(body, {
    ...ctx, objects: staged.store,
    prepareMarkup: async (fields, source) => {
      const result = await prepareJsx(fields, source, ctx);
      if (result instanceof Response) return result;
      markup = result;
      return result.content;
    },
  });
  if (content instanceof Response) return content;
  return {content, objects: staged.objects, ...(markup ? {markup} : {})};
}

/** The only persistent half of a prepared publication. */
export async function applyPreparedContent(prepared: PreparedContent, effects: Pick<ContentInputCtx, 'importAsset' | 'resolveFont'> = {}): Promise<StoredContent | Response> {
  const content = prepared.markup ? await applyPreparedJsx(prepared.markup, effects) : prepared.content;
  if (content instanceof Response) return content;
  for (const object of prepared.objects) await objectStore().put(object.key, object.bytes, object.contentType);
  return content;
}
