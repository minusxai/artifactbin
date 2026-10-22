/** No authored expressions, engine configuration or remote images enter this adapter. */
export interface CompiledMermaidPlan {
  readonly id: string;
  readonly code: string;
  readonly title?: string;
  readonly className?: string;
}
export interface MermaidPalette {
  background: string; foreground: string; primary: string; border: string;
  card: string; muted: string; accent: string; mutedForeground: string;
  fontFamily: string; fontSize: string; fontMono: string; dark: boolean;
}
export interface CompiledMermaidVariant {
  readonly svg: string;
  readonly width: number;
  readonly height: number;
  readonly palette: MermaidPalette;
  /** Original engine label widths with the page fonts loaded, for independent proof. */
  readonly textWidths: readonly number[];
}
export interface PreparedMermaidPlan extends CompiledMermaidPlan {
  readonly variants: Readonly<Record<'light' | 'dark', CompiledMermaidVariant>>;
}
export interface MermaidPreparationInput {
  /** Exact complete SSR context and already self-contained CSS, never author scripts. */
  readonly html: string;
  readonly css: string;
  readonly plans: readonly CompiledMermaidPlan[];
}
