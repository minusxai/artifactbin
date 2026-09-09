/** Browser-safe transport seam: preserve one canonical CSS copy without changing the surface contract. */
export interface CssSurface {
  compiledCss: string | null;
  runtime?: { compiledCss: string | null };
}
export type CompactSurface<T extends CssSurface> = Omit<T, 'compiledCss'> & { compiledCss?: string | null };
export function compactSurface<T extends CssSurface>(surface: T): CompactSurface<T> {
  throw new Error('M1: implement compact surface transport');
}
export function expandSurface<T extends CssSurface>(surface: CompactSurface<T>): T {
  throw new Error('M1: implement surface transport decoding');
}
