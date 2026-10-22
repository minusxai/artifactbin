import type { CompiledScalarControl } from "./scalar-control-contracts.ts";
import { admitDataControl } from "./data-controls.ts";
const text = (value: unknown) =>
  typeof value === "string" && value.length <= 4096;
const binding = (value: unknown) =>
  typeof value === "string" &&
  /^\$[A-Za-z][A-Za-z0-9_]*$/.test(value) &&
  !["constructor", "prototype", "__proto__"].includes(value.slice(1));
/** Preserve the trusted kit's local-state behavior without accepting its open-ended shell props. */
export function admitScalarControl(
  tag: string,
  attrs: Readonly<Record<string, unknown>>,
  hasChildren = false,
): CompiledScalarControl {
  if (hasChildren || !["Segmented", "Switch", "Slider"].includes(tag))
    throw Error("Unsupported scalar control");
  const common = ["id", "label", "className", "disabled"];
  const allowed = [
    ...common,
    ...(tag === "Segmented"
      ? ["value", "options", "placeholder"]
      : tag === "Switch"
        ? ["checked"]
        : ["value", "min", "max", "step", "format", "prefix", "suffix"]),
  ];
  if (
    Object.keys(attrs).some(
      (key) => !allowed.includes(key) && !/^data-af-(?:id|comment)$/.test(key),
    )
  )
    throw Error("Unsupported scalar control attribute");
  for (const key of [
    "id",
    "label",
    "className",
    "placeholder",
    "format",
    "prefix",
    "suffix",
  ])
    if (attrs[key] !== undefined && !text(attrs[key]))
      throw Error("Invalid scalar control text");
  if (attrs.disabled !== undefined && typeof attrs.disabled !== "boolean")
    throw Error("Invalid scalar control disabled");
  const value = attrs[tag === "Switch" ? "checked" : "value"];
  if (!binding(value)) throw Error("Scalar control requires a declared Value");
  if (tag === "Segmented") {
    const { disabled: _, ...selectAttrs } = attrs;
    const options = admitDataControl("Select", selectAttrs);
    if (options.kind !== "select") throw Error("Invalid segmented options");
    return {
      tag,
      binding: (value as string).slice(1),
      valueType: "string",
      options,
    };
  }
  if (tag === "Slider") {
    for (const key of ["min", "max", "step"])
      if (
        attrs[key] !== undefined &&
        (typeof attrs[key] !== "number" || !Number.isFinite(attrs[key]))
      )
        throw Error("Invalid slider bound");
    const min = (attrs.min ?? 0) as number,
      max = (attrs.max ?? 100) as number;
    if (min >= max || (attrs.step !== undefined && (attrs.step as number) <= 0))
      throw Error("Invalid slider range");
  }
  return {
    tag: tag as "Switch" | "Slider",
    binding: (value as string).slice(1),
    valueType: tag === "Switch" ? "boolean" : "number",
  };
}
