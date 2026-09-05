/**
 * ENV, AUDITED. One spelling — MODULE__NAME — and every read recorded, so
 * that at boot a service can name (a) a name of our shape nobody asked for
 * (a typo, silently unset otherwise) and (b) a retired name still in use.
 * This only works when every package reads EAGERLY at construction.
 */
export interface EnvOptions {
  /** Prefixes a service reads dynamically, by group rather than by name: never "unknown". */
  consumedByPrefix?: string[];
  /** Old name → its replacement. */
  retired?: Record<string, string>;
}
export interface Env {
  env(module: string, name: string): string | undefined;
  must(module: string, name: string): string;
  namesRead(): ReadonlySet<string>;
  unknownNames(): string[];
  retiredInUse(): Array<{ name: string; replacement: string }>;
}

/**
 * WHAT COUNTS AS ONE OF OUR NAMES. The module half admits an UNDERSCORE, and that is not cosmetic: while it
 * did not, NO name in a multi-word module was auditable at all, so a knob left behind by a retired
 * vocabulary sat on a box looking live and the boot notice said nothing about it. MEASURED when the rate
 * limits moved into a policy file; the app's own audit (`services/app/lib/config.ts`) has always used the
 * wider shape, and this is the two of them agreeing.
 */
const OURS = /^[A-Z][A-Z0-9_]*__[A-Z0-9_]+$/;

export function createEnv(source: Record<string, string | undefined>, opts: EnvOptions = {}): Env {
  const asked = new Set<string>();
  const env = (module: string, name: string) => { const key = `${module}__${name}`; asked.add(key); return source[key]; };
  return {
    env,
    must: (module, name) => { const v = env(module, name); if (v === undefined || v === '') throw new Error(`${module}__${name} is required and not set`); return v; },
    namesRead: () => asked,
    unknownNames: () => Object.keys(source).filter((k) => OURS.test(k) && !asked.has(k) && !(opts.consumedByPrefix ?? []).some((p) => k.startsWith(p))).sort(),
    retiredInUse: () => Object.entries(opts.retired ?? {}).filter(([old]) => source[old] !== undefined).map(([name, replacement]) => ({ name, replacement })),
  };
}
