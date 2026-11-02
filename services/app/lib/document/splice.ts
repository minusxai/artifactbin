/** Unguessable edit identity shared by native publication and metadata writes. */
export function newEditId(): string {
  return Array.from(globalThis.crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('');
}
