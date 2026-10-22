import type { AuthorEffectLifetime } from "./lifecycle-contracts.ts";
import type {
  AuthorWindowEvent,
  AuthorWindowFacade,
  AuthorWindowPort,
} from "./window-contracts.ts";
const eventTypes = new Set(["resize", "scroll", "hashchange", "pointerup"]);
function record<T extends object>(fields: T): Readonly<T> {
  return Object.freeze(Object.assign(Object.create(null), fields));
}
/** Deliberately returns neither native events nor native MediaQueryList objects. */
export function createAuthorWindowFacade(
  port: AuthorWindowPort,
  lifetime: AuthorEffectLifetime,
): AuthorWindowFacade {
  const assertActive = () => {
    if (!lifetime.active) throw Error("Author effect lifetime is disposed");
  };
  const listeners = <T>(
    target: EventTarget,
    types: ReadonlySet<string>,
    project: (event: Event) => T,
  ) => {
    const callbacks = new WeakMap<Function, EventListener>();
    return {
      addEventListener(
        type: string,
        callback: (event: T) => void,
        options?: boolean | AddEventListenerOptions,
      ) {
        assertActive();
        if (!types.has(type) || typeof callback !== "function")
          throw Error("Unsupported author window event");
        let wrapper = callbacks.get(callback);
        if (!wrapper) {
          wrapper = (event) => callback(project(event));
          callbacks.set(callback, wrapper);
        }
        lifetime.listen(target, type, wrapper, options);
      },
      removeEventListener(
        type: string,
        callback: (event: T) => void,
        options?: boolean | EventListenerOptions,
      ) {
        if (!types.has(type) || typeof callback !== "function")
          throw Error("Unsupported author window event");
        const wrapper = callbacks.get(callback);
        if (wrapper) lifetime.unlisten(target, type, wrapper, options);
      },
    };
  };
  const project = (event: Event): Readonly<AuthorWindowEvent> => {
    const fields: {
      type: string;
      timeStamp: number;
      key?: string;
      button?: number;
      clientX?: number;
      clientY?: number;
    } = { type: event.type, timeStamp: event.timeStamp };
    for (const key of ["key", "button", "clientX", "clientY"] as const) {
      const value = (event as unknown as Record<string, unknown>)[key];
      if (key === "key" && typeof value === "string") fields.key = value;
      else if (
        key !== "key" &&
        typeof value === "number" &&
        Number.isFinite(value)
      )
        fields[key] = value;
    }
    return record(fields);
  };
  const result = Object.create(null);
  for (const key of [
    "innerWidth",
    "innerHeight",
    "devicePixelRatio",
    "scrollX",
    "scrollY",
  ] as const)
    Object.defineProperty(result, key, {
      enumerable: true,
      get() {
        assertActive();
        const value = port[key];
        if (!Number.isFinite(value))
          throw Error("Invalid author window scalar");
        return value;
      },
    });
  Object.assign(result, listeners(port, eventTypes, project), {
    matchMedia(query: string) {
      assertActive();
      if (
        typeof query !== "string" ||
        !query.trim() ||
        query.length > 512 ||
        /[\x00-\x1f]/.test(query)
      )
        throw Error("Unsupported author media query");
      const native = port.matchMedia(query);
      const wrapper = Object.create(null);
      Object.defineProperties(wrapper, {
        media: {
          enumerable: true,
          get() {
            assertActive();
            return String(native.media);
          },
        },
        matches: {
          enumerable: true,
          get() {
            assertActive();
            return Boolean(native.matches);
          },
        },
      });
      Object.assign(
        wrapper,
        listeners(native, new Set(["change"]), () =>
          record({
            type: "change" as const,
            matches: Boolean(native.matches),
            media: String(native.media),
          }),
        ),
      );
      return Object.freeze(wrapper);
    },
  });
  return Object.freeze(result);
}
