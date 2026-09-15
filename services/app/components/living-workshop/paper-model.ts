/** Geometry and gesture decisions, independent of the renderer or browser. */
export const SCENE = { width: 1448, height: 815 };
export interface Point {
  x: number;
  y: number;
}
export interface PaperSlot extends Point {
  id: string;
  width: number;
  height: number;
  angle: number;
}
export interface PaperGesture {
  id: string;
  origin: Point;
  current: Point;
  dragging: boolean;
}
export function scenePoint(
  point: Point,
  bounds: { left: number; top: number; width: number; height: number },
): Point {
  return {
    x: ((point.x - bounds.left) * SCENE.width) / Math.max(1, bounds.width),
    y: ((point.y - bounds.top) * SCENE.height) / Math.max(1, bounds.height),
  };
}
export function beginGesture(id: string, point: Point): PaperGesture {
  return { id, origin: point, current: point, dragging: false };
}
export function moveGesture(gesture: PaperGesture, point: Point): PaperGesture {
  return {
    ...gesture,
    current: point,
    dragging:
      gesture.dragging ||
      Math.hypot(point.x - gesture.origin.x, point.y - gesture.origin.y) > 10,
  };
}
