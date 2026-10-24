import type { BrowserParityFixture, BrowserStateExpectation } from './contract';
/** Additional observable table semantics; decorative header arrows remain raw evidence. */
interface InteractionStateExpectation extends BrowserStateExpectation {
  bodyRows?: string[][];
}
export interface InteractionParityFixture extends Omit<BrowserParityFixture, 'states'> {
  provenance: { revision: string; files: string[]; facts: string[] };
  states: Array<Omit<BrowserParityFixture['states'][number], 'expected'> & { expected: InteractionStateExpectation }>;
}
