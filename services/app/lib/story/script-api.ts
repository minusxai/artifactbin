interface ArtifactApiConfig {
  resolveUrl: string | null;
  libraries: Record<string, string>;
}
/** Inline bootstrap also works for documents that need no hydration runtime. */
export function artifactApiScript(config: ArtifactApiConfig): string {
  const data = JSON.stringify(config).replace(/</g, '\\u003c');
  // Dynamic import is intentional here: URLs come only from the platform's
  // pinned registry, and no library belongs in the ordinary reader bundle.
  return `(() => {
    const config = ${data};
    const loaded = new Map();
    window.artifact = Object.freeze({
      async library(name) {
        if (!Object.prototype.hasOwnProperty.call(config.libraries, name)) throw new Error('Unknown library: ' + name);
        if (!loaded.has(name)) loaded.set(name, import(config.libraries[name]).catch(error => { loaded.delete(name); throw error; }));
        return loaded.get(name);
      },
      async resolve(ref) {
        if (typeof ref !== 'string' || !/^ref:[a-zA-Z0-9]{6}$/.test(ref)) throw new Error('Expected ref:<id>');
        if (!config.resolveUrl) throw new Error('Publish the document before resolving assets');
        const url = new URL(config.resolveUrl);
        url.searchParams.set('ref', ref);
        const response = await fetch(url.href, { method: 'HEAD', credentials: 'omit', cache: 'no-store' });
        if (!response.ok) throw new Error(response.status === 404 ? 'not found' : 'asset unavailable');
        return url.href;
      }
    });
  })();`;
}
