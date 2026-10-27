import registry from './registry.json';

/** Closed browser modules; engine-specific entries may register only selected types. */
export interface LibrarySpec {
  package: string;
  version: string;
  entry: string;
  bundledPackages?: Record<string, string>;
  aliases?: Record<string, {package: string; version: string}>;
}
const libraries: Record<string, LibrarySpec> = registry;

/** Pages import hosted libraries as `@afbin/<name>`; the whole `@afbin/` prefix is platform-reserved. */
export const LIBRARY_SPECIFIER_PREFIX = '@afbin/';

/**
 * The one place a page's library build is chosen. `pinnedVersion` is the version recorded in
 * `meta.htmlLibraries` when the page was published. Only the current build is retained today,
 * so every page resolves to it; a later retained-build store would honour the pin here.
 */
export function resolveLibraryUrl(name: string, pinnedVersion?: string, origin = ''): string {
  void pinnedVersion;
  return `${origin}/libraries/${name}-${libraries[name]!.version}/index.js`;
}

/** A versioned, platform-owned module URL; callers cannot supply package names or CDN URLs. */
export function libraryUrls(origin = ''): Record<string, string> {
  return Object.fromEntries(Object.keys(libraries).map(name => [name, resolveLibraryUrl(name, undefined, origin)]));
}

/** Name -> version of every hosted library, recorded on a page at publish. */
export function libraryVersions(): Record<string, string> {
  return Object.fromEntries(Object.entries(libraries).map(([name, spec]) => [name, spec.version]));
}

/** Import-map entries (`@afbin/<name>` -> URL) for a page, honouring its recorded pins. */
export function libraryImports(pins: unknown, skip: ReadonlySet<string> = new Set()): Record<string, string> {
  const pinned = pins && typeof pins === 'object' ? pins as Record<string, unknown> : {};
  return Object.fromEntries(Object.keys(libraries)
    .filter(name => !skip.has(LIBRARY_SPECIFIER_PREFIX + name))
    .map(name => [LIBRARY_SPECIFIER_PREFIX + name, resolveLibraryUrl(name, typeof pinned[name] === 'string' ? pinned[name] : undefined)]));
}

/** `@afbin/vega` -> `/libraries/vega-6.3.1/index.js`; undefined for any other specifier. */
export function libraryPathForSpecifier(specifier: string): string | undefined {
  if (!specifier.startsWith(LIBRARY_SPECIFIER_PREFIX)) return undefined;
  const name = specifier.slice(LIBRARY_SPECIFIER_PREFIX.length);
  return Object.hasOwn(libraries, name) ? resolveLibraryUrl(name) : undefined;
}
