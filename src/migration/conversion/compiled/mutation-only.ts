import type { MutationOnlyImportInput } from './mutation-only-contracts.ts';
/** Registration has already verified SQL and backend authority. Keep mutation-only imports
 * without opening a read engine; reject any mismatch rather than adding a dummy query. */
export function admitsMutationOnlyImports(input: MutationOnlyImportInput): boolean {
 const names=input.declaredMutationNames;
 return !input.queryNames.length && !input.localMutationNames.length && names.length>0 &&
  new Set(names).size===names.length && input.registeredMutationNames.length===names.length &&
  new Set(input.registeredMutationNames).size===names.length && names.every(name=>input.registeredMutationNames.includes(name));
}
