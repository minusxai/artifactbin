/** Migration-only input. No stylesheet or font fetch occurs in conversion. */
export interface FontAxisRange {
  readonly tag: string;
  readonly min: number;
  readonly max: number;
}
export interface PinnedFontRequest {
  readonly families: readonly {
    readonly family: string;
    readonly axes: readonly FontAxisRange[];
  }[];
  readonly display: "auto" | "block" | "swap" | "fallback" | "optional";
}
export interface PinnedFontFace {
  readonly family: string;
  readonly axes: readonly FontAxisRange[];
  readonly style: "normal" | "italic";
  readonly weight: readonly [number, number];
  readonly unicodeRange: string;
  readonly bytes: Uint8Array;
  readonly sha256: string;
}
export interface InlinedFontReceipt {
  readonly requestSha256: string;
  readonly faces: readonly {
    readonly sha256: string;
    readonly bytes: number;
  }[];
}
export interface InlinedFontStylesheet {
  readonly css: string;
  readonly receipts: readonly InlinedFontReceipt[];
}
export type ResolvePinnedFonts = (
  request: PinnedFontRequest,
  context?: { readonly requestUrl: string; readonly requestSha256: string },
) => Promise<readonly PinnedFontFace[]>;
export const MAX_FONT_BYTES = 2_000_000;
export const MAX_FONT_TOTAL_BYTES = 8_000_000;
export const MAX_FONT_FACES = 64;
export interface InspectedFont {
  readonly families: readonly string[];
  readonly axes: readonly (FontAxisRange & { readonly default: number })[];
  readonly weight: number;
  readonly style: "normal" | "italic";
}
