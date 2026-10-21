import type { CompositionSpec, FrameState } from "./contracts.ts";
export function validateSpec(spec: CompositionSpec): void {
  for (const key of ["width", "height", "fps", "frameCount"] as const) {
    if (!Number.isSafeInteger(spec[key]) || spec[key] <= 0) throw new RangeError(`Invalid ${key}`);
  }
}
export function frameState(spec: CompositionSpec, frame: number): FrameState {
  validateSpec(spec);
  if (!Number.isSafeInteger(frame) || frame < 0 || frame >= spec.frameCount) throw new RangeError("Invalid frame");
  const sceneIndex = Math.min(3, Math.floor(frame * 4 / spec.frameCount));
  const start = Math.ceil(sceneIndex * spec.frameCount / 4);
  const end = Math.ceil((sceneIndex + 1) * spec.frameCount / 4) - 1;
  return {
    frame,
    seconds: frame / spec.fps,
    progress: spec.frameCount === 1 ? 0 : frame / (spec.frameCount - 1),
    scene: (["morning", "imbalance", "rebalance", "outcome"] as const)[sceneIndex],
    sceneProgress: end <= start ? 0 : (frame - start) / (end - start),
  };
}
