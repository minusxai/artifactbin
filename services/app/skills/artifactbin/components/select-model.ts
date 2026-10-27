/** Internal helper for af-select; not a public entry point. */
import type { AfSelectOption, AfSelectScalar, AfSelectValue } from './select';
export interface SelectEntry { value: AfSelectScalar; label: string; key: string }
export function selectKey(value: AfSelectScalar | null): string { return `${typeof value}:${String(value)}`; }
export function normalizeOptions(input: unknown): SelectEntry[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>(); const result: SelectEntry[] = [];
  for (const option of input) {
    const value: unknown = option !== null && typeof option === 'object' ? option.value : option;
    if (!(typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value))) continue;
    const key = selectKey(value); if (seen.has(key)) continue; seen.add(key);
    const label: unknown = option !== null && typeof option === 'object' ? option.label : value;
    result.push({ value, label: label === undefined || label === null ? String(value) : String(label), key });
  }
  return result;
}
export function normalizeSelection(input: unknown, multiple: boolean): AfSelectValue {
  if (multiple) return normalizeOptions(input).map(entry => entry.value);
  return normalizeOptions([input])[0]?.value ?? null;
}
function sameSelection(a: AfSelectValue, b: AfSelectValue): boolean {
  return Array.isArray(a) && Array.isArray(b) ? a.length === b.length && a.every((value, index) => value === b[index]) : a === b;
}
/** Only a changed draft whose starting value remains current may commit. */
export function draftCommit(start: AfSelectValue, current: AfSelectValue, draft: AfSelectScalar[], accepted: boolean): AfSelectScalar[] | null {
  return accepted && sameSelection(start, current) && !sameSelection(current, draft) ? [...draft] : null;
}
export function optionInput(input: unknown): AfSelectOption[] { return normalizeOptions(input).map(({ value, label }) => ({ value, label })); }
