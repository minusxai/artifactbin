/** Offline chart compilation only: the browser receives Vega dataflow, never JSX or a spec compiler. */
export interface ChartCompilationInput {
  viz: Record<string, unknown>;
  columns: Array<{ name: string; type: string }>;
  rows: Record<string, unknown>[];
  width: number;
  height: number;
  colorMode: "light" | "dark";
}
export interface CompiledChartPlan {
  key: string;
  runtime: Record<string, unknown>;
  width: number;
  height: number;
  /** Fixed envelope leaves supplied as signal DATA, never expression source. */
  textBindings?: Array<{ path: string[]; signal: string; marker: string }>;
}
export interface ChartCompilerPorts {
  envelope(
    viz: Record<string, unknown>,
    columns: ChartCompilationInput["columns"],
  ): unknown;
  resolve(
    envelope: unknown,
    columns: unknown,
  ): {
    ok: boolean;
    error?: string;
    assets?: Record<string, unknown>;
    [key: string]: unknown;
  };
  infer(rows: ChartCompilationInput["rows"]): unknown;
  plan(
    resolved: unknown,
    rows: ChartCompilationInput["rows"],
    size: { width: number; height: number },
    mode: string,
    palette: null,
  ): { vegaSpec: unknown; parserConfig?: unknown; facetLayout?: unknown };
  parse(spec: unknown, config: unknown, options: { ast: true }): unknown;
}
export interface ChartView {
  signal?(name: string, value: string | number | boolean | null): ChartView;
  data(name: string, rows: Record<string, unknown>[]): ChartView;
  width(value: number): ChartView;
  height(value: number): ChartView;
  resize(): ChartView;
  runAsync(): Promise<unknown>;
  finalize(): void;
}
export interface ChartRendererPorts {
  create(runtime: Record<string, unknown>, element: HTMLElement): ChartView;
  observe(element: HTMLElement, resize: () => void): () => void;
}
export interface CompiledChartController {
  update(rows: Record<string, unknown>[]): void;
  destroy(): void;
}
