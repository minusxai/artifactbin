import type { BrowserParityFixture } from './contract';

/** Provenance is checked against the pinned original Git object, never a recreated old face. */
export interface ControlBaselineFixture extends BrowserParityFixture {
  /** Same expected-state shape used by the shared browser capture contract. */
  states: Array<BrowserParityFixture['states'][number] & {
    expected: {
      roles?: Array<{ role: string; name: string; checked?: boolean | string; pressed?: boolean | string; selected?: boolean | string; expanded?: boolean | string; disabled?: boolean; value?: string }>;
      textIncludes?: string[];
      hiddenText?: string[];
      rolesAbsent?: Array<{ role: string; name: string }>;
    };
  }>;
  provenance: {
    revision: string;
    path: string;
    sha256: string;
    exports: string[];
  };
}
