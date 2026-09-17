import registry from './registry.json';

/** A versioned, platform-owned module URL; callers cannot supply package names or CDN URLs. */
export function libraryUrls(origin = ''): Record<string, string> {
  return Object.fromEntries(Object.entries(registry).map(([name, spec]) =>
    [name, `${origin}/libraries/${name}-${spec.version}/index.js`],
  ));
}
