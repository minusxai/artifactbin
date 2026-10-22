import { createHash } from "node:crypto";
import type {
  VizRecipePageInput,
  VizRecipePagePlan,
  VizRecipeSlot,
} from "./contracts.ts";
const record = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const name = (v: unknown): v is string =>
  typeof v === "string" && /^\w+$/.test(v) && v.length <= 128;
/** Offline admission only; the recipe stays inert JSON and its original bytes are retained. */
export function planVizRecipePage(
  input: VizRecipePageInput,
): VizRecipePagePlan {
  const fail = (): never => {
    throw Error("Invalid archived visualization recipe");
  };
  if (
    !input ||
    input.format !== "viz" ||
    typeof input.title !== "string" ||
    input.title.length > 10000 ||
    input.coreUrl !== "/af/v1/core.js" ||
    !Number.isSafeInteger(input.sourceVersion) ||
    input.sourceVersion < 1 ||
    typeof input.source !== "string" ||
    Buffer.byteLength(input.source) > 1024 * 1024 ||
    !/^[a-f0-9]{64}$/.test(input.sourceSha256) ||
    createHash("sha256").update(input.source).digest("hex") !==
      input.sourceSha256
  )
    fail();
  let parsed: unknown;
  try {
    parsed = JSON.parse(input.source);
  } catch {
    fail();
  }
  if (
    !record(parsed) ||
    typeof parsed.description !== "string" ||
    !["vega", "vega-lite"].includes(String(parsed.engine)) ||
    !Array.isArray(parsed.bindings) ||
    !parsed.bindings.length ||
    parsed.bindings.length > 128 ||
    !record(parsed.template)
  )
    return fail();
  const names = new Set<string>(),
    slotNames = new Set<string>();
  const slots: VizRecipeSlot[] = parsed.bindings.map((binding: unknown) => {
    if (
      !record(binding) ||
      !name(binding.name) ||
      names.has(binding.name) ||
      typeof binding.label !== "string" ||
      !Array.isArray(binding.accepts) ||
      !binding.accepts.length ||
      binding.accepts.some(
        (a: unknown) =>
          !["nominal", "quantitative", "temporal"].includes(String(a)),
      ) ||
      (binding.multi !== undefined && typeof binding.multi !== "boolean")
    )
      return fail();
    names.add(binding.name);
    slotNames.add(binding.name);
    return {
      name: binding.name,
      label: binding.label,
      accepts: binding.accepts as VizRecipeSlot["accepts"],
      ...(binding.multi === undefined ? {} : { multi: binding.multi }),
    };
  });
  if (parsed.params != null) {
    if (!Array.isArray(parsed.params) || parsed.params.length > 128)
      return fail();
    for (const param of parsed.params) {
      if (
        !record(param) ||
        !name(param.name) ||
        names.has(param.name) ||
        typeof param.label !== "string"
      )
        return fail();
      names.add(param.name);
    }
  }
  const inspect = (v: unknown, depth = 0): void => {
    if (depth > 64) fail();
    if (typeof v === "string") {
      for (const match of v.matchAll(/\{\{(\w+)(:kind)?\}\}/g)) {
        if (!names.has(match[1]!) || (match[2] && !slotNames.has(match[1]!)))
          fail();
      }
    } else if (Array.isArray(v)) {
      for (const child of v) inspect(child, depth + 1);
    } else if (record(v)) {
      for (const child of Object.values(v)) inspect(child, depth + 1);
    }
  };
  inspect(parsed.template);
  return {
    title: input.title,
    coreUrl: input.coreUrl,
    source: input.source,
    description: parsed.description,
    engine: parsed.engine as "vega-lite" | "vega",
    slots,
    provenance: {
      format: "viz",
      sourceVersion: input.sourceVersion,
      sourceSha256: input.sourceSha256,
    },
  };
}
