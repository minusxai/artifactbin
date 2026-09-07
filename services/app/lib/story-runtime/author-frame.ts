/** Trusted wrapper document. Inner content is data, never wrapper script source. */
export function protectedAuthorDocument(innerDocument: string): string {
  throw new Error('managed-runtime: implement');
}
