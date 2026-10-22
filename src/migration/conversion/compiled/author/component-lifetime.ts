import type {
  AuthorComponentLifetime,
  AuthorComponentOwners,
} from "./component-lifetime-contracts.ts";
import type { AuthorListener } from "./lifecycle-contracts.ts";
/** One factory per initialized module. Exact duplicate listeners keep their first owner,
 * matching native addEventListener semantics rather than inventing reference counting. */
export function createAuthorComponentLifetime<Owner extends object>(
  owners: AuthorComponentOwners<Owner>,
): AuthorComponentLifetime {
  type Scope = {
    owner: Owner;
    active: boolean;
    registrations: Set<Registration>;
  };
  type Registration = {
    scope: Scope;
    target: EventTarget;
    type: string;
    listener: AuthorListener;
    capture: boolean;
    wrapped: EventListener;
    signal?: AbortSignal;
    abort?: () => void;
  };
  const scopes = new WeakMap<Owner, Scope>(),
    liveScopes = new Set<Scope>(),
    registrations = new Set<Registration>();
  let active = true;
  const capture = (options?: boolean | EventListenerOptions) =>
    typeof options === "boolean" ? options : Boolean(options?.capture);
  const drain = (callbacks: (() => void)[]) => {
    const errors: unknown[] = [];
    for (const callback of callbacks)
      try {
        callback();
      } catch (error) {
        errors.push(error);
      }
    if (errors.length)
      throw new AggregateError(errors, "Author component retirement failed");
  };
  const remove = (registration: Registration) => {
    if (!registrations.delete(registration)) return;
    registration.scope.registrations.delete(registration);
    drain([
      () =>
        registration.target.removeEventListener(
          registration.type,
          registration.wrapped,
          registration.capture,
        ),
      () => {
        if (registration.abort)
          registration.signal?.removeEventListener("abort", registration.abort);
      },
    ]);
  };
  const retire = (scope: Scope) => {
    if (!scope.active) return;
    scope.active = false;
    liveScopes.delete(scope);
    drain(
      [...scope.registrations].map(
        (registration) => () => remove(registration),
      ),
    );
  };
  const current = () => {
    if (!active) throw Error("Author component lifetime is disposed");
    const owner = owners.current();
    if (!owner) throw Error("Author component callback has no owner");
    let scope = scopes.get(owner);
    if (!scope) {
      if (liveScopes.size >= 10_000)
        throw Error("Author component owner limit");
      scope = { owner, active: true, registrations: new Set() };
      scopes.set(owner, scope);
      liveScopes.add(scope);
      const registered = scope;
      try {
        owners.cleanup(owner, () => retire(registered));
      } catch (error) {
        registered.active = false;
        liveScopes.delete(registered);
        throw error;
      }
    }
    if (!scope.active) throw Error("Author component owner is disposed");
    return scope;
  };
  return {
    get active() {
      return active;
    },
    listen(target, type, listener, options) {
      const scope = current();
      if (
        !(target instanceof EventTarget) ||
        typeof type !== "string" ||
        !type ||
        !(
          typeof listener === "function" ||
          (listener && typeof listener.handleEvent === "function")
        )
      )
        throw Error("Invalid author component listener");
      if (
        options &&
        typeof options === "object" &&
        Object.keys(options).some(
          (key) => !["capture", "once", "passive", "signal"].includes(key),
        )
      )
        throw Error("Unsupported author component listener options");
      const cap = capture(options);
      if (
        [...registrations].some(
          (r) =>
            r.target === target &&
            r.type === type &&
            r.listener === listener &&
            r.capture === cap,
        )
      )
        return;
      if (registrations.size >= 10_000)
        throw Error("Author component resource limit");
      const opts =
        typeof options === "object" && options !== null
          ? {
              once: Boolean(options.once),
              passive: Boolean(options.passive),
              signal: options.signal,
            }
          : undefined;
      if (opts?.signal?.aborted) return;
      const registration: Registration = {
        scope,
        target,
        type,
        listener,
        capture: cap,
        wrapped: () => {},
        signal: opts?.signal,
      };
      registration.wrapped = function (event) {
        if (!active || !scope.active || !registrations.has(registration))
          return;
        if (opts?.once) remove(registration);
        owners.run(scope.owner, () => {
          if (typeof listener === "function") listener.call(target, event);
          else listener.handleEvent(event);
        });
      };
      registrations.add(registration);
      scope.registrations.add(registration);
      try {
        target.addEventListener(type, registration.wrapped, {
          capture: cap,
          passive: opts?.passive,
        });
        if (opts?.signal) {
          registration.abort = () => remove(registration);
          opts.signal.addEventListener("abort", registration.abort, {
            once: true,
          });
        }
      } catch (error) {
        try {
          remove(registration);
        } catch {}
        throw error;
      }
    },
    unlisten(target, type, listener, options) {
      for (const registration of registrations)
        if (
          registration.target === target &&
          registration.type === type &&
          registration.listener === listener &&
          registration.capture === capture(options)
        )
          remove(registration);
    },
    callback(callback) {
      if (typeof callback !== "function")
        throw Error("Author component callback must be a function");
      const scope = current();
      return function (this: unknown, ...args) {
        if (!active || !scope.active) return undefined;
        return owners.run(scope.owner, () => callback.apply(this, args));
      };
    },
    dispose() {
      if (!active) return;
      active = false;
      drain([...liveScopes].map((scope) => () => retire(scope)));
    },
  };
}
