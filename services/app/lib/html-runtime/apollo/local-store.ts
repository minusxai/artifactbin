/**
 * The page's local state document (a StatePort) and the JSON helpers it and the page client share. Not GraphQL: the
 * viewer state (../viewer-state) and the comment view keep one of these each.
 */
import type { HtmlJson as AfJson, HtmlJsonObject as AfJsonObject } from "@artifactbin/contracts";
import { check } from "./storable";
import type { StatePort } from "./apollo-contracts";

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/* ------------------------------------------------------------------ data */

/** A mutable deep copy of storable data. */
export function clone<T extends AfJson | undefined>(value: T): T {
  return value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T);
}

export function canonical(value: AfJson | undefined): string {
  if (value === undefined) return "u";
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value !== null && typeof value === "object")
    return (
      "{" +
      Object.keys(value)
        .sort()
        .map((key) => JSON.stringify(key) + ":" + canonical(value[key]))
        .join(",") +
      "}"
    );
  return JSON.stringify(value);
}

export const own = (document: AfJsonObject, key: string): AfJson | undefined =>
  Object.hasOwn(document, key) ? document[key] : undefined;

/** Sets an own data property: a storable JSON key such as `__proto__` stays a field, never the object's prototype. */
export const setOwn = (document: Record<string, unknown>, key: string, value: unknown): void => {
  Object.defineProperty(document, key, { value, writable: true, enumerable: true, configurable: true });
};

/* ----------------------------------------------------------- local store */

export function createLocalStore(initial: AfJsonObject = {}): StatePort {
  check(initial, "state", new Set());
  if (initial === null || typeof initial !== "object" || Array.isArray(initial))
    throw new TypeError("Local state must be an object");
  let document: AfJsonObject = clone(initial);
  const listeners = new Set<(document: AfJsonObject) => void>();
  return {
    read: () => clone(document),
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async write(change) {
      for (const [key, value] of Object.entries(change.expected))
        if (canonical(own(document, key)) !== canonical(value)) return { status: "conflict", document: clone(document) };
      if (change.exact)
        for (const key of Object.keys(document))
          if (!Object.hasOwn(change.expected, key)) return { status: "conflict", document: clone(document) };
      try {
        for (const [key, value] of Object.entries(change.next)) if (value !== undefined) check(value, key, new Set());
      } catch (error) {
        return { status: "rejected", document: clone(document), error: message(error) };
      }
      const updated: AfJsonObject = { ...document };
      for (const [key, value] of Object.entries(change.next)) {
        if (value === undefined) delete updated[key];
        else setOwn(updated, key, clone(value));
      }
      document = updated;
      for (const listener of [...listeners])
        try {
          listener(clone(document));
        } catch {
          /* One view cannot stop another from updating. */
        }
      return { status: "committed", document: clone(document) };
    },
  };
}
