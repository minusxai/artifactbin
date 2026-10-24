interface BrowserRoleExpectation {
  role: string;
  name: string;
  checked?: boolean | string;
  pressed?: boolean | string;
  selected?: boolean | string;
  expanded?: boolean | string;
  sort?: 'none' | 'ascending' | 'descending';
  valueNow?: string | number | null;
  valueMin?: string | number | null;
  valueMax?: string | number | null;
  disabled?: boolean;
  focused?: boolean;
  value?: string | number;
}
export interface BrowserStateExpectation {
  roles?: BrowserRoleExpectation[];
  rolesAbsent?: Array<{ role: string; name: string }>;
  textIncludes?: string[];
  hiddenText?: string[];
  rows?: string[][];
  bodyRows?: string[][];
  bodyRowsInclude?: string[][];
}
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
  states: Array<{ id: string; expected?: BrowserStateExpectation; actions: Array<{ role: string; name: string; action: 'click' | 'focus' | 'press' | 'scroll'; key?: string }> }>;
}
export interface BrowserParityCapture {
  fixture: string;
  state: string;
  theme: 'light' | 'dark';
  viewport: { width: number; height: number };
  implementation: 'jsx' | 'html';
  sourceRevision: string;
  fixtureHash: string;
  screenshotMode: 'viewport';
  browserVersion: string;
  screenshot: string;
  screenshotSha256: string;
  semantics: unknown;
  errors: string[];
  assertionErrors: string[];
  resourceEvidence?: { stylesheets: Array<{ url: string; loaded: boolean }>; errors: string[] };
  fontEvidence: { faces: unknown[]; used: unknown[]; resources: unknown[]; errors: string[] };
}

/** A failed state is diagnostics, never a successful parity capture. */
export interface BrowserCaptureFailure {
  fixture: string;
  state: string;
  theme: 'light' | 'dark';
  viewport: { width: number; height: number };
  implementation: 'jsx' | 'html';
  sourceRevision: string;
  phase: string;
  action?: { action: string; role: string; name: string; key?: string };
  message: string;
  screenshot?: string;
  semantics?: unknown;
  diagnostics: unknown;
}
