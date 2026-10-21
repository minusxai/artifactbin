/** Bounded experiment: pinned CommonMark, raw HTML disabled, no plugins. */
export interface MarkdownRenderer {
  render(source: string): string;
  encode(source: string): string;
  decode(json: string): string;
}
export interface MarkdownElement extends HTMLElement {
  /** Explicitly commit a complete source, including on asynchronously assembled elements. */
  setSource(source: string): void;
}
export interface ComponentRegistration {
  /** Resolve only after canonical source has been captured. Reject to prevent hydration. */
  sourceCaptured: Promise<void>;
}
export interface Loader {
  readonly status: 'idle' | 'loading' | 'ready' | 'failed';
  retry(): Promise<void>;
  disconnect(): void;
}
export interface ComponentConstructor extends CustomElementConstructor { rendererVersion: string }
export interface LoaderOptions extends ComponentRegistration {
  load(attempt: number): Promise<{register(options: ComponentRegistration): ComponentConstructor}>;
}
