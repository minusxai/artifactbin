/** Both implementations must be served through their real application reader. */
export interface BrowserParityFixture {
  id: string;
  family: string;
  oldJsx: string;
  newHtml: string;
  modules: string[];
  setup?: string;
  /** Honest exclusions: these are not evidence of covered behavior. */
  limitations?: string[];
  states: Array<{ id: string; actions: Array<{ role: string; name: string; action: 'click' | 'focus' | 'press'; key?: string }> }>;
}
export interface BrowserParityCapture {
  fixture: string;
  state: string;
  theme: 'light' | 'dark';
  viewport: { width: number; height: number };
  implementation: 'jsx' | 'html';
  sourceRevision: string;
  fixtureHash: string;
  screenshot: string;
  screenshotSha256: string;
  semantics: unknown;
  errors: string[];
}
