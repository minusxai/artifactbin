/** Receiver viewport geometry; clipping never alters the native Selection. */
export interface SelectionPaintRect {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface VisibleSelectionRect {
  rect: SelectionPaintRect;
  /** Intersection of viewport and every clipping ancestor of this text run. */
  clip: SelectionPaintRect;
}
