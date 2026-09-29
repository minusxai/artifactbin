/**
 * THE MODULE STORE (docs/phase2-architecture.md §2.1, §9; contract ModuleStore).
 *
 * A compiled version's per-document browser module — and its speculation-rule
 * file (lib/compiled-page/speculation) — are bytes addressed by their own
 * digest in the object store (lib/object-store): `sha256(bytes)` hex, first 16.
 * The same bytes are the same key, so a republish that compiles to an unchanged
 * module stores nothing new, and every key is immutable — which is what lets
 * `GET /islands/d/<sha>.js` answer `immutable` and the store's read cache hold it.
 *
 * The route serves only what this store wrote: a sha that is not 16 lowercase
 * hex characters is refused HERE, before any key is formed, so no request can
 * name a key outside the two prefixes below, and an unknown sha is a null
 * (a 404), never a compile.
 */
import { objectStore, ObjectUnavailable, type ObjectStore } from '@/lib/object-store';
import { DOCUMENT_MODULE_PATH, DOCUMENT_MODULE_RE, type ModuleRef, type ModuleStore } from './contract';
import { contentSha, speculationRulesOf, SPECULATION_RULES_CONTENT_TYPE, type SpeculationRules } from './speculation';

/** The object-store prefix of per-document modules (`islands/<sha>`). */
const MODULE_PREFIX = 'islands';
/** Speculation rules live beside them under their own prefix, so a module URL can never serve a rule file or the reverse. */
const RULES_PREFIX = 'islands/s';
const TEMPLATES_PREFIX = 'islands/t';
export const TEMPLATE_RESOURCE_PATH = '/islands/t';

/** One resource per compiled version; old content addresses remain readable with pinned builds. */
export function createTemplateResourceStore(objects: ObjectStore = objectStore()) {
  return {
    async put(templates: Readonly<Record<string, string>>): Promise<string> {
      const bytes = new TextEncoder().encode(JSON.stringify(templates));
      const sha = contentSha(bytes);
      await objects.put(`${TEMPLATES_PREFIX}/${sha}`, Buffer.from(bytes), 'application/json');
      return `${TEMPLATE_RESOURCE_PATH}/${sha}.json`;
    },
    get: (sha: string) => read(objects, TEMPLATES_PREFIX, sha),
  };
}

/** The bytes at `<prefix>/<sha>`, or null for a malformed sha (never looked up) or one nothing wrote. */
async function read(objects: ObjectStore, prefix: string, sha: string): Promise<Uint8Array | null> {
  if (!DOCUMENT_MODULE_RE.test(sha)) return null;
  try {
    return await objects.get(`${prefix}/${sha}`);
  } catch (error) {
    // Missing and unreadable are one answer to a reader (lib/object-store ObjectUnavailable): not served.
    if (error instanceof ObjectUnavailable) return null;
    throw error;
  }
}

/** Per-document modules over the object store; `objects` is injectable for a test, the configured store otherwise. */
export function createModuleStore(objects: ObjectStore = objectStore()): ModuleStore {
  return {
    async put(bytes, imports) {
      const sha = contentSha(bytes);
      await objects.put(`${MODULE_PREFIX}/${sha}`, Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength), 'text/javascript');
      const ref: ModuleRef = { sha, url: `${DOCUMENT_MODULE_PATH}/${sha}.js`, bytes: bytes.byteLength, imports: [...imports] };
      return ref;
    },
    get: (sha) => read(objects, MODULE_PREFIX, sha),
  };
}

/** The speculation-rule files the assembler names in `Speculation-Rules` (`/islands/s/<sha>.json`). */
export interface SpeculationRulesStore {
  /**
   * Write the rule file for these prerender hints (idempotent); null when there
   * is nothing to prerender. The sha is `speculationRulesOf`'s, so it is the
   * one the assembler names for the same hints.
   */
  put(prerender: readonly string[]): Promise<SpeculationRules | null>;
  /** The file's bytes for a sha this store wrote, or null. */
  get(sha: string): Promise<Uint8Array | null>;
}

export function createSpeculationRulesStore(objects: ObjectStore = objectStore()): SpeculationRulesStore {
  return {
    async put(prerender) {
      const rules = speculationRulesOf(prerender);
      if (rules) await objects.put(`${RULES_PREFIX}/${rules.sha}`, rules.text, SPECULATION_RULES_CONTENT_TYPE);
      return rules;
    },
    get: (sha) => read(objects, RULES_PREFIX, sha),
  };
}
