export interface BrowserParitySelection {
  fixtureIds?: string[];
}
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
export interface BrowserParityAction {
  role: string;
  name: string;
  /** Exact retained authored DOM id for native elements without a browser role. */
  authoredId?: string;
  action: 'click' | 'focus' | 'press' | 'scroll' | 'upload';
  key?: string;
  /** Authored disposable upload inputs are part of the static paired fixture hash. */
  files?: Array<{name:string;mimeType:string;text?:string;bytes?:number}>;
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
  states: Array<{ id: string; expected?: BrowserStateExpectation; actions: BrowserParityAction[] }>;
}
export interface BrowserParityCapture {
  fixture: string;
  state: string;
  theme: 'light' | 'dark';
  viewport: { width: number; height: number };
  implementation: 'jsx' | 'html';
  sourceRevision: string;
  fixtureHash: string;
  screenshotMode: 'viewport' | 'document-frame';
  browserVersion: string;
  screenshot: string;
  screenshotSha256: string;
  semantics: unknown;
  errors: string[];
  assertionErrors: string[];
  resourceEvidence?: { stylesheets: Array<{ url: string; loaded: boolean }>; errors: string[] };
  animationEvidence?: {
    format: 'frame-animation-settlement-v1';
    reducedMotion: boolean;
    startedAtMs: number;
    completedAtMs: number;
    elapsedMs: number;
    observed: number;
    alreadyFinished: number;
    alreadyIdle: number;
    paused: Array<{ name: string; playState: string; duration: number | null; iterations: number | 'infinite' | null }>;
    infinite: Array<{ name: string; playState: string; duration: number | null; iterations: number | 'infinite' | null }>;
    counts: { finished: number; canceled: number; detached: number };
    timedOut: Array<{ name: string; playState: string; duration: number | null; iterations: number | 'infinite' | null }>;
  };
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

/** A disposable local identity reference. Credentials are never persisted in evidence. */
export interface BaselineAccountReference {
  email: `mxmx_test_${string}@example.com`;
}
export interface BaselineBrowserSession {
  /** Browser session cookies only; API bearer tokens must never enter browser storage. */
  mount(page: { context(): { addCookies(cookies: Array<{ name: string; value: string; url: string }>): Promise<void> }; request: { get(url: string): Promise<{ ok(): boolean; json(): Promise<{ user?: { id?: string; email?: string } }> }> } }): Promise<void>;
}

/** Actual account data read back after normal local profile operations. */
export interface BaselineSeededIdentity {
  id: string;
  name: string | null;
  handle: string;
  image: string | null;
}

/** Every reader state has finite readiness and camera budgets, including custom hooks. */
export interface BrowserCaptureTimeouts {
  readyTimeoutMs?: number;
  captureStepTimeoutMs?: number;
  animationSettleTimeoutMs?: number;
}
