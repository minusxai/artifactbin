import registry from './registry.json';
import hostedComponents from '../html-components/hosted.json';

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

/**
 * Hosted HTML components (D20): `@afbin/<component>` -> `/af/components/<component>.js`, the platform's current build
 * (lib/build-assets/components, served by lib/document-serving/components.server). The entry address carries no version, so it
 * revalidates; the shared `chunk-<hash>.js` files it imports are content-addressed and immutable.
 */
export const COMPONENTS_PATH = '/af/components/';
const components: readonly string[] = hostedComponents.components;
/** Served at /af/components/: the components, and the legacy `af-deck-gl`/`af-mermaid` wrappers, which have no
 * `@afbin/` name (the deck.gl library owns `@afbin/deck-gl`; new maps and diagrams use the libraries) and load by URL. */
export const isHostedComponent = (name: string): boolean => components.includes(name) || hostedComponents.legacy.includes(name);
export const componentUrl = (name: string, origin = ''): string => `${origin}${COMPONENTS_PATH}${name}.js`;
/** Every hosted component's import-map entry. */
export function componentImports(origin = ''): Record<string, string> {
  return Object.fromEntries(components.filter(name => !Object.hasOwn(libraries, name)).map(name => [LIBRARY_SPECIFIER_PREFIX + name, componentUrl(name, origin)]));
}

/** Import-map entries (`@afbin/<name>` -> URL) for a page: the libraries, honouring its recorded pins, and the components. */
export function libraryImports(pins: unknown, skip: ReadonlySet<string> = new Set()): Record<string, string> {
  const pinned = pins && typeof pins === 'object' ? pins as Record<string, unknown> : {};
  return Object.fromEntries([...Object.keys(libraries)
    .map(name => [LIBRARY_SPECIFIER_PREFIX + name, resolveLibraryUrl(name, typeof pinned[name] === 'string' ? pinned[name] : undefined)]),
  ...Object.entries(componentImports())].filter(([specifier]) => !skip.has(specifier!)));
}

/** `@afbin/vega` -> `/libraries/vega-6.3.1/index.js`, `@afbin/tabs` -> `/af/components/tabs.js`; undefined for any other specifier. */
export function libraryPathForSpecifier(specifier: string): string | undefined {
  if (!specifier.startsWith(LIBRARY_SPECIFIER_PREFIX)) return undefined;
  const name = specifier.slice(LIBRARY_SPECIFIER_PREFIX.length);
  return Object.hasOwn(libraries, name) ? resolveLibraryUrl(name) : components.includes(name) ? componentUrl(name) : undefined;
}
