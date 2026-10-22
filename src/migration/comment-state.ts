import type { Json, JsonObject } from "../contracts.ts";
import type {
  MigrationCommentStateInput,
  MigrationCommentStateProjection,
} from "./comment-state-contracts.ts";
import { readLocalSourceManifest } from "./conversion/compiled/source-manifest.ts";
import { validLocalValue } from "./conversion/compiled/local-state.ts";
const record = (v: unknown): v is Record<string, unknown> =>
  !!v &&
  typeof v === "object" &&
  !Array.isArray(v) &&
  Object.getPrototypeOf(v) === Object.prototype;
/** Frozen v2 JSON bounds; no getters, prototype keys, coercion or source execution. */
function bounded(value: unknown): boolean {
  let budget = 4096;
  const visit = (v: unknown, depth: number): boolean => {
    if (--budget < 0 || depth > 16) return false;
    if (v === null || typeof v === "boolean") return true;
    if (typeof v === "string") return v.length <= 32768;
    if (typeof v === "number") return Number.isFinite(v);
    if (Array.isArray(v))
      return (
        v.length <= 4096 &&
        Array.from({ length: v.length }, (_, i) =>
          Object.getOwnPropertyDescriptor(v, String(i)),
        ).every((d) => !!d && "value" in d && visit(d.value, depth + 1))
      );
    return (
      record(v) &&
      Object.entries(Object.getOwnPropertyDescriptors(v)).every(
        ([k, d]) =>
          k.length > 0 &&
          k.length <= 128 &&
          !["__proto__", "constructor", "prototype"].includes(k) &&
          "value" in d &&
          visit(d.value, depth + 1),
      )
    );
  };
  try {
    return visit(value, 0) && Buffer.byteLength(JSON.stringify(value)) <= 32768;
  } catch {
    return false;
  }
}
/** All-or-nothing, exact retained-source projection. Unsupported state remains inert in the archive. */
export function projectMigrationCommentState(
  input: MigrationCommentStateInput,
): MigrationCommentStateProjection {
  const unavailable = (
    reason: Extract<
      MigrationCommentStateProjection["status"],
      { status: "unavailable" }
    >["reason"],
  ): MigrationCommentStateProjection => ({
    raw: input.raw,
    status: { status: "unavailable", reason },
    snapshot: null,
  });
  if (!input.sourceRevision || input.legacySource === null)
    return unavailable("source-unavailable");
  if (!bounded(input.raw)) return unavailable("invalid-state");
  const raw = input.raw as Record<string, unknown>;
  if (
    !record(raw) ||
    raw.v !== 2 ||
    Object.keys(raw).some((k) => !["v", "state"].includes(k)) ||
    !record(raw.state) ||
    Object.keys(raw.state).length > 256
  )
    return unavailable("unsupported-format");
  if (Object.keys(raw.state).some((k) => k !== "$"))
    return unavailable("unproven-signal");
  const saved = Object.hasOwn(raw.state, "$") ? raw.state.$ : {};
  if (!record(saved)) return unavailable("invalid-state");
  try {
    const declarations = readLocalSourceManifest(
      input.legacySource,
      [],
      "historical-unavailable",
    ).declarations;
    const base = structuredClone(input.initialState ?? {}),
      local = base.compiledPage;
    if (declarations.length && !record(local))
      return unavailable("unproven-value");
    for (const declaration of declarations) {
      if (
        !record(local) ||
        !Object.hasOwn(local, declaration.name) ||
        !validLocalValue(declaration, local[declaration.name]) ||
        JSON.stringify(local[declaration.name]) !==
          JSON.stringify(declaration.default)
      )
        return unavailable("unproven-value");
    }
    for (const [name, value] of Object.entries(saved)) {
      const declaration = declarations.find((d) => d.name === name);
      if (
        !declaration ||
        !validLocalValue(declaration, value) ||
        !record(local)
      )
        return unavailable("unproven-value");
      local[name] = structuredClone(value) as Json;
    }
    return {
      raw: input.raw,
      status: { status: "available", viewport: "document-start" },
      snapshot: {
        schema: input.initialState ? 1 : 0,
        sourceRevision: input.sourceRevision,
        state: base as JsonObject,
        view: { x: 0, y: 0 },
      },
    };
  } catch {
    return unavailable("unproven-value");
  }
}
