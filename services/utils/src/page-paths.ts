/** First-party page admission. Never an API, author byte route or iframe renderer. */
export function isPlatformPage(path: string): boolean {
  return ['/', '/login', '/account', '/tokens', '/tokens/new', '/trash', '/chat', '/assets', '/datasets/new', '/privacy', '/terms', '/docs-human'].includes(path)
    || /^\/@[\w-]+\/?$/.test(path)
    || /^\/datasets\/[A-Za-z0-9]+\/edit$/.test(path);
}
