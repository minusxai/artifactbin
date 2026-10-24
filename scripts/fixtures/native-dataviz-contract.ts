interface NativeDatavizRow { category: string; count: number }
export interface NativeDatavizController {
  refresh(): Promise<void>;
  updateNativeRows(rows: NativeDatavizRow[]): Promise<void>;
  dispose(): void;
}
export interface NativeDatavizExamples {
  lite: Record<string, unknown> & {data: {values: NativeDatavizRow[]}};
  vega: Record<string, unknown>;
}
