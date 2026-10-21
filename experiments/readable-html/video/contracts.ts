/** Optional research contract: a composition is rendered at explicit frame indexes. */
export interface CompositionSpec {
  width: number;
  height: number;
  fps: number;
  frameCount: number;
}
export interface FrameState {
  frame: number;
  seconds: number;
  progress: number;
  scene: "morning" | "imbalance" | "rebalance" | "outcome";
  sceneProgress: number;
}
export interface HtmlComposition {
  readonly spec: CompositionSpec;
  /** Resolves after fonts, images and other declared assets are ready. */
  readonly ready: Promise<void>;
  /** Must fully establish the requested frame, irrespective of previous calls. */
  renderFrame(frame: number): Promise<void>;
}

export interface RoadPoint { x: number; y: number }
export interface RoadSampler { length: number; pointAt(distance: number): RoadPoint }
/** Contacts are the visible tire bottoms, in the vehicle's own coordinates. */
export interface VehicleContacts { left: RoadPoint; right: RoadPoint; scale: number }
export interface RoadPlacement {
  left: RoadPoint;
  right: RoadPoint;
  angle: number;
  transform: string;
  /** Apply the exact same affine transform used for drawing. */
  project(point: RoadPoint): RoadPoint;
}
