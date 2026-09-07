/** Pure wire contract for the trusted controls iframe's visible/hit-test regions. */
export interface ControlsRect {x: number; y: number; width: number; height: number}

export function controlsClipPath(rects: unknown, width: number, height: number): string {
  const empty = 'inset(100%)';
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0 || !Array.isArray(rects) || rects.length > 256) return empty;
  const paths: string[] = [];
  for (const rect of rects) {
    if (!rect || typeof rect !== 'object' || !['x','y','width','height'].every(key => typeof rect[key] === 'number' && Number.isFinite(rect[key])) || rect.width < 0 || rect.height < 0) return empty;
    const x = Math.max(0, Math.min(width, Math.floor(rect.x)));
    const y = Math.max(0, Math.min(height, Math.floor(rect.y)));
    const right = Math.max(0, Math.min(width, Math.ceil(rect.x + rect.width)));
    const bottom = Math.max(0, Math.min(height, Math.ceil(rect.y + rect.height)));
    if (right > x && bottom > y) paths.push(`M${x} ${y}H${right}V${bottom}H${x}Z`);
  }
  return paths.length ? `path("${paths.join(' ')}")` : empty;
}
