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

/** A versioned, platform-owned module URL; callers cannot supply package names or CDN URLs. */
export function libraryUrls(origin = ''): Record<string, string> {
  return Object.fromEntries(Object.entries(libraries).map(([name, spec]) =>
    [name, `${origin}/libraries/${name}-${spec.version}/index.js`],
  ));
}
