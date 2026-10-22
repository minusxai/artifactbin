import type { NormalizeSourceTimestamp } from "./timestamp-contracts.ts";
/** JSON aggregation bypasses pg's column parsers. Reapply only the native,
 * attested timestamp grammar; date and ordinary string columns never enter here.
 */
export const normalizeSourceTimestamp: NormalizeSourceTimestamp = (
  value,
  oid,
) => {
  if (value === null) return null;
  const date = new Date(oid === 1114 ? `${value}Z` : value);
  if (Number.isNaN(date.getTime())) return oid === 1114 ? value : null;
  return date.toISOString();
};
