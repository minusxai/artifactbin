/** Source-only receipts for remote writes retained in unavailable historical pages.
 * These names grant no runtime operation or backend authority.
 */
export type ReadHistoricalRemoteMutationNames = (
  source: string,
) => readonly string[];
