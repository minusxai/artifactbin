import type { ArtifactHead } from '@/lib/artifact-backend/types';
import { BLANK_REPORT_MARKUP, isStartPlaceholder } from '@/lib/start-placeholder';
import { prepareClientDocumentUpdate } from '@/lib/story/graph/document-update-client';

/** Convert only the starter the person observed; the existing commit protocol
 * also rejects a concurrent update between this read and the write. */
export function prepareBlankReport(head: ArtifactHead, observedEditId: string) {
  if (head.edit_id !== observedEditId || !isStartPlaceholder(head.markup, head.version) || !head.document) {
    throw new Error('This artifact has changed. Reload to see the latest version.');
  }
  return {
    edit_id: observedEditId,
    document_update: prepareClientDocumentUpdate({ ...head, document: head.document, meta: { theme: head.theme, template: head.template, colorMode: head.colorMode } }, { source: BLANK_REPORT_MARKUP, whole: true }),
  };
}
