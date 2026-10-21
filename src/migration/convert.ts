import type { Converter } from './contracts.ts';
import { convertLegacyJsx, convertLegacyDocument } from './conversion/index.ts';
/** Explicit content dispatch: canonical JSON must never turn into an empty HTML page. */
export const convertMigrationContent: Converter = input => input.document !== null && input.document !== undefined
 ? convertLegacyDocument(input.document, {source:input.source,coreUrl:input.coreUrl})
 : convertLegacyJsx({source:input.source,coreUrl:input.coreUrl});
