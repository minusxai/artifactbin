import type { Converter } from './contracts.ts';
import { convertLegacyJsx, convertLegacyDocument } from './conversion/index.ts';
/** Prefer retained markup; canonical JSON alone must never become an empty page. */
export const convertMigrationContent: Converter = input => input.source.trim()
 ? convertLegacyJsx({source:input.source,coreUrl:input.coreUrl})
 : input.document !== null && input.document !== undefined
 ? convertLegacyDocument(input.document, {coreUrl:input.coreUrl})
 : {classification:'manual-blocked',html:null,issues:['Missing source content'],identities:{}};
