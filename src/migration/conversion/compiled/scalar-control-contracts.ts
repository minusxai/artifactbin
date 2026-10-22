import type { CompiledDataControl } from "./data-control-contracts.ts";
/** A viewer-local archived control; source admission checks the declared Value type. */
export interface CompiledScalarControl {
  readonly tag: "Segmented" | "Switch" | "Slider" | "Dialog";
  readonly binding: string;
  readonly valueType: "string" | "boolean" | "number";
  readonly options?: Extract<CompiledDataControl, { kind: "select" }>;
}
