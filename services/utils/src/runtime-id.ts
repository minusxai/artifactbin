/** UUIDs for runtime instances and operations, including internal HTTP export pages.
 * getRandomValues is available outside secure contexts; randomUUID is not.
 */
export function runtimeId(): string {
  let index = 0;
  const bytes = crypto.getRandomValues(new Uint8Array(31));
  // XOR the variant's two random bits into RFC 4122's fixed 10 prefix.
  return '00000000-0000-4000-8000-000000000000'.replace(/[08]/g, kind => (+kind ^ (bytes[index++]! & (15 >> (+kind / 4)))).toString(16));
}
