import type { MapViewState, Feature, Row } from "../viz/deck-engine-core";
export interface DeckGLOptions {
  data: readonly Row[];
  layers: unknown;
  basemap?: "auto" | "light" | "dark" | "none";
  colorMode?: "light" | "dark";
  initialViewState?: Partial<MapViewState>;
  tooltip?: boolean | string[];
  legend?: boolean;
  title?: string;
  height?: number;
  /** Geometry supplied by the author or bundled with the document; no boundary fetch is implicit. */
  boundaries?: Readonly<Record<string, Feature[]>>;
}
/** Fit follows data and size until a reader gesture; reset resumes fitting. */
export class DeckViewModel {
  private moved = false;
  constructor(public view: MapViewState) {}
  fit(next: MapViewState): void {
    if (!this.moved) this.view = next;
  }
  move(next: MapViewState, byReader: boolean): void {
    this.moved ||= byReader;
    this.view = next;
  }
  reset(next: MapViewState): void {
    this.moved = false;
    this.view = next;
  }
}
/** Async adapters must never attach after replacement or disconnection. */
export class DeckGeneration {
  private generation = 0;
  next(): () => boolean {
    const version = ++this.generation;
    return () => version === this.generation;
  }
  invalidate(): void {
    this.generation++;
  }
}
