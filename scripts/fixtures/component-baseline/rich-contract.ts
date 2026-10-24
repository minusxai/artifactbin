import type { BrowserParityFixture } from './contract';
/** Public APIs inspected at this exact original revision. Extra metadata is
 * evidence/provenance, never a substitute for captures from the real readers. */
export interface RichBrowserParityFixture extends BrowserParityFixture {
  provenance: { revision: string; publicNames: string[]; sources: string[] };
}
export interface RichBaselineReadiness {
  jsx: () => boolean;
  html: () => boolean;
}
