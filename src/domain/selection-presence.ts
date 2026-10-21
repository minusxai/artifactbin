import type { SelectionPresence } from "../contracts.ts";
const MAX_TEXT = 100000;
export function selectionFingerprint(text: string): string {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++)
    hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  return (hash >>> 0).toString(16).padStart(8, "0");
}
export function validateSelection(input: unknown): SelectionPresence | null {
  if (!input || typeof input !== "object") return null;
  const ranges = (input as SelectionPresence).ranges;
  if (!Array.isArray(ranges) || !ranges.length || ranges.length > 8)
    return null;
  const result: SelectionPresence = { ranges: [] };
  for (const range of ranges) {
    if (
      !range ||
      typeof range.fingerprint !== "string" ||
      !/^[a-f0-9]{8}$/.test(range.fingerprint) ||
      typeof range.nodeId !== "string" ||
      !range.nodeId.length ||
      range.nodeId.length > 100 ||
      !Number.isInteger(range.start) ||
      !Number.isInteger(range.end) ||
      !Number.isInteger(range.length) ||
      range.start < 0 ||
      range.end <= range.start ||
      range.end > range.length ||
      range.length > MAX_TEXT
    )
      return null;
    result.ranges.push({
      nodeId: range.nodeId,
      start: range.start,
      end: range.end,
      length: range.length,
      fingerprint: range.fingerprint,
    });
  }
  return result;
}
