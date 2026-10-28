import type { BrowserParityFixture, BrowserStateExpectation } from './contract';

/** Provenance is checked against the pinned original Git object, never a recreated old face. */
export interface ControlBaselineFixture extends BrowserParityFixture {
  /** Same expected-state shape used by the shared browser capture contract. */
  states: Array<BrowserParityFixture['states'][number] & {
    expected: BrowserStateExpectation;
  }>;
  provenance: {
    revision: string;
    path: string;
    sha256: string;
    exports: string[];
  };
}
