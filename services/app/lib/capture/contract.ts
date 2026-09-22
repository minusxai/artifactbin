/** Capture owns browser resources; anchors, persistence and editing belong to callers. */
export interface CaptureRect { x: number; y: number; width: number; height: number }
export interface CapturedImage {
  blob: Blob;
  width: number;
  height: number;
  rect: CaptureRect;
  viewport: { width: number; height: number };
  capturedAt: string;
  method: 'region' | 'canvas' | 'upload';
}
export interface CaptureSession {
  /** The top-level viewport rectangle, measured after the source picker settles. Always disposes. */
  capture(rect: CaptureRect): Promise<CapturedImage>;
  dispose(): void;
}
export type CaptureFailure = 'unsupported' | 'cancelled' | 'wrong-source' | 'ended' | 'timeout' | 'geometry';
export class CaptureError extends Error {
  constructor(public readonly code: CaptureFailure) { super(code); this.name = 'CaptureError'; }
}
