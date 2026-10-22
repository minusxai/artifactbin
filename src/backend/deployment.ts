import { createHash } from "node:crypto";
import { boundedBackendSchema } from "../graphql/execution-policy.ts";
import { jsonCopy } from "../json.ts";
import {
  BackendHostError,
  type BackendLockfile,
  type CompiledBackend,
} from "./contracts.ts";
/**
 * The runtime generation: the executor's entry contract (workerd, esbuild and
 * the frame protocol). Change it whenever src/backend/container changes what a
 * compiled bundle needs from its executor. A deployment of the current
 * generation runs on whatever image the host is configured with; the image it
 * was compiled on is recorded after `/image:` for diagnosis only. A deployment
 * of another generation is recompiled from its stored source on first use
 * (src/backend/af-files.ts) and keeps its version.
 */
export const BACKEND_RUNTIME =
  "workerd@1.20261019.1/esbuild@0.25.12/protocol@4";
export const digest = (text: string) =>
  createHash("sha256").update(text).digest("hex");
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// protocol@4: named dataset mutation capabilities and trusted dataset-change failures.
const CURRENT = new RegExp(
  "^" + escape(BACKEND_RUNTIME) + "(?:/image:(sha256:[a-f0-9]{64}))?$",
);
/** True when a deployment's runtime is of the current generation, whatever image it recorded. */
export function isCurrentRuntime(runtime: unknown): boolean {
  return typeof runtime === "string" && CURRENT.test(runtime);
}
/** The image ID a deployment was compiled on, if it recorded one. Informational. */
export function recordedImage(runtime: string): string | undefined {
  return CURRENT.exec(runtime)?.[1];
}
/**
 * A backend's version names what its viewers call: its source and schema.
 * The bundle and runtime are checked by their own fields, not the version, so
 * an image rebuild or a recompile for a new generation keeps the version.
 */
const versionOf = (source: string, typeDefs: string, fields: string[]) =>
  digest(JSON.stringify({ source, typeDefs, fields }));
export function sealDeployment(
  source: string,
  bundle: string,
  metadata: Metadata,
): CompiledBackend {
  try {
    const content = sealedContent(source, bundle, metadata);
    return jsonCopy({
      version: versionOf(content.source, content.typeDefs, content.fields),
      ...content,
    });
  } catch {
    throw new BackendHostError("schema_rejected");
  }
}
interface Metadata {
  typeDefs: string;
  fields: string[];
  runtime?: string;
  lockfile?: BackendLockfile;
}
const LOCK_URL = /^https:\/\/esm\.sh\/[\x21-\x7e]{1,2000}$/;
const INTEGRITY = /^sha256-[A-Za-z0-9+/]{43}=$/;
function validLockfile(lockfile: unknown): lockfile is BackendLockfile {
  if (!lockfile || typeof lockfile !== "object" || Array.isArray(lockfile))
    return false;
  const entries = Object.entries(lockfile);
  return (
    entries.length <= 64 &&
    entries.every(
      ([key, value]) =>
        key.length > 0 &&
        key.length <= 2000 &&
        value &&
        typeof value === "object" &&
        Object.keys(value).sort().join() === "integrity,url" &&
        typeof value.url === "string" &&
        LOCK_URL.test(value.url) &&
        typeof value.integrity === "string" &&
        INTEGRITY.test(value.integrity),
    )
  );
}
function sealedContent(source: string, bundle: string, metadata: Metadata) {
  metadata = jsonCopy(metadata);
  if (
    typeof source !== "string" ||
    Buffer.byteLength(source) > 262144 ||
    typeof bundle !== "string" ||
    Buffer.byteLength(bundle) > 1048576
  )
    throw Error();
  if (
    typeof metadata.typeDefs !== "string" ||
    Buffer.byteLength(metadata.typeDefs) > 65536 ||
    !Array.isArray(metadata.fields) ||
    metadata.fields.some((f) => typeof f !== "string")
  )
    throw Error();
  if (metadata.runtime !== undefined && !isCurrentRuntime(metadata.runtime))
    throw Error();
  const schema = boundedBackendSchema(metadata.typeDefs);
  if (schema.getSubscriptionType()) throw Error();
  const fields = [
    ...Object.keys(schema.getQueryType()?.getFields() ?? {}),
    ...Object.keys(schema.getMutationType()?.getFields() ?? {}),
  ].sort();
  if (
    new Set(fields).size !== fields.length ||
    JSON.stringify(fields) !== JSON.stringify([...metadata.fields].sort())
  )
    throw Error();
  const lockfile = metadata.lockfile ?? {};
  if (!validLockfile(lockfile)) throw Error();
  return {
    source,
    sourceHash: digest(source),
    bundle,
    bundleHash: digest(bundle),
    typeDefs: metadata.typeDefs,
    fields,
    runtime: metadata.runtime ?? BACKEND_RUNTIME,
    lockfile,
  };
}
export function verifyDeployment(input: CompiledBackend): void {
  try {
    const copy = jsonCopy(input);
    const content = sealedContent(copy.source, copy.bundle, {
      typeDefs: copy.typeDefs,
      fields: [...copy.fields],
      runtime: copy.runtime,
      lockfile: copy.lockfile,
    });
    // Deployments stored before versions named only source and schema were
    // versioned by their whole content; they stay valid.
    const versions = [
      versionOf(content.source, content.typeDefs, content.fields),
      digest(JSON.stringify(content)),
    ];
    if (
      Object.keys(copy).length !== Object.keys(content).length + 1 ||
      !versions.includes(copy.version) ||
      Object.entries(content).some(
        ([k, v]) =>
          JSON.stringify(v) !==
          JSON.stringify(copy[k as keyof CompiledBackend]),
      )
    )
      throw Error();
  } catch {
    throw new BackendHostError("deployment_invalid");
  }
}
