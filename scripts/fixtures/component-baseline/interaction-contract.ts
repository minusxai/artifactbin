import type { BrowserParityFixture, BrowserStateExpectation } from './contract';
/** Additional observable table semantics; decorative header arrows remain raw evidence. */
interface InteractionStateExpectation extends BrowserStateExpectation {
  bodyRows?: string[][];
}
export interface InteractionParityFixture extends Omit<BrowserParityFixture, 'states'> {
  provenance: { revision: string; files: string[]; facts: string[] };
  states: Array<Omit<BrowserParityFixture['states'][number], 'expected'> & { expected: InteractionStateExpectation }>;
}

/** Observable scroll/slide coordinates; null means the selected slide is unavailable. */
export interface SlideGeometrySettleOptions {
  implementation: 'jsx' | 'html';
  timeoutMs?: number;
  stableMs?: number;
  tolerance?: number;
  sample?: () => number[] | null;
  now?: () => number;
  nextFrame?: () => Promise<unknown>;
}
