/** Browser-safe transport seam: preserve one canonical CSS copy without changing the surface contract. */
interface CssSurface {
  compiledCss: string | null;
  runtime?: { compiledCss: string | null };
}
export type CompactSurface<T extends CssSurface> = Omit<T, 'compiledCss'> & { compiledCss?: string | null };
export function compactSurface<T extends CssSurface>(surface: T): CompactSurface<T> {
  if (!surface.runtime || surface.runtime.compiledCss !== surface.compiledCss) return surface;
  const { compiledCss: _css, ...compact } = surface;
  return compact;
}
export function expandSurface<T extends CssSurface>(surface: CompactSurface<T>): T {
  return { ...surface, compiledCss: surface.compiledCss !== undefined ? surface.compiledCss : surface.runtime?.compiledCss ?? null } as T;
}
