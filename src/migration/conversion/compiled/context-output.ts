import type {CompiledContextMetadata,CompiledContextReference} from './context-contracts.ts';
/** Ordinary metadata only. The importer must resolve its structural href through readiness. */
export function contextMetadata(references: readonly CompiledContextReference[]): CompiledContextMetadata {
 if(references.length>1||references.some(ref=>!ref||! /^[A-Za-z0-9]{6,12}$/.test(ref.legacyId)))throw Error('Invalid supporting document reference');
 return {head:references.map(ref=>`<link rel="related" href="ref:${ref.legacyId}" data-migration-context="supporting-document">`).join(''),provenance:references.map(ref=>({legacyId:ref.legacyId}))};
}
