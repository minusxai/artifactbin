/** Includes the currently executing frame; admission happens before async work. */
export interface LiveQueueLimits {
  readonly pendingFrames: number;
  readonly pendingBytes: number;
  readonly framesPerSecond: number;
}
export const LIVE_QUEUE_LIMITS: LiveQueueLimits = {
  pendingFrames: 32,
  pendingBytes: 2 * 1024 * 1024,
  framesPerSecond: 60,
};
