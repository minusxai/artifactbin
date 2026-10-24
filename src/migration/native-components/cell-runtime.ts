import { formatNativeCell, NATIVE_CELL_SOURCE_PROOF } from "./cell-format.ts";
import type { NativeCellOptions } from "./cell-contracts.ts";
/** The original formatter's undefined locale is the viewer's browser locale, not a migration-time guess. */
const locale = new Intl.NumberFormat(undefined, {
  maximumFractionDigits: 2,
}).resolvedOptions();
export function formatNativeLiveCell(
  rows: readonly Readonly<Record<string, unknown>>[] | null,
  options: NativeCellOptions,
): string {
  const result = formatNativeCell({
    ...options,
    rows,
    localeReceipt: {
      locale: locale.locale,
      numberingSystem: locale.numberingSystem,
      sourceRuntimeSha256: NATIVE_CELL_SOURCE_PROOF.numberFormatSha256,
    },
  });
  if (result.status !== "formatted") throw Error(result.detail);
  return result.text;
}
