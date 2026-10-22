/** Private offline capture receipts. Never embedded as remote resource addresses in pages. */
export interface CapturedFontFaceReceipt {
  readonly family: string;
  readonly style: "normal" | "italic";
  readonly weight: readonly [number, number];
  readonly stretch?: readonly [number, number];
  readonly unicodeRange: string;
  readonly sourceUrl: string;
  readonly sha256: string;
  readonly bytes: number;
}
export interface CapturedFontStylesheetReceipt {
  readonly requestUrl: string;
  readonly requestSha256: string;
  readonly stylesheetSha256: string;
  readonly stylesheetBytes: number;
  readonly omittedRequests?: readonly import("./contracts.ts").FontRequestOmission[];
  readonly faces: readonly CapturedFontFaceReceipt[];
}
export interface CapturedFontManifest {
  readonly version: 1;
  readonly capturedAt: string;
  readonly stylesheets: readonly CapturedFontStylesheetReceipt[];
}
/** Both values are supplied explicitly by offline tooling and included in cache identity. */
export interface CapturedFontBundleInput {
  readonly directory: string;
  readonly manifestSha256: string;
}
export const FONT_CAPTURE_LIMITS = Object.freeze({
  stylesheetBytes: 256_000,
  fontBytes: 2_000_000,
  expandedFontBytes: 4_000_000,
  totalFontBytes: 8_000_000,
  stylesheets: 8,
  faces: 64,
  deadlineMs: 30_000,
});
