/** Server-owned sibling captured before author DOM is mounted into the SPA. */
let initialStory: Element | null = null;
let initialPath = '';
/**
 * The server's story wrapper: the body's last child carrying the attribute —
 * the page data (web/bootstrap) now rides after it, as the very last element.
 */
function servedWrapper(): Element | null {
  const children = document.body.children;
  for (let i = children.length - 1; i >= 0; i--) if (children[i]!.hasAttribute('data-mx-initial-story')) return children[i]!;
  return null;
}
export function captureInitialStory(): void {
  const candidate = servedWrapper();
  initialStory = candidate?.hasAttribute('data-mx-initial-story') ? candidate : null;
  initialPath = window.location.pathname;
}
/** Clear the captured server sibling before an app-route commit can paint. */
export function clearInitialStoryOnRoute(pathname: string): void {
  if (pathname !== initialPath) clearInitialStory();
}
export function clearInitialStory(): void {
  initialStory?.remove();
  initialStory = null;
}
/**
 * The server-rendered document story (lib/story-runtime/inline-composition)
 * waiting to be hydrated, when there is one — a starter's instructions are not
 * one. It stays in place until the inline runtime adopts it.
 */
export function initialDocumentStory(): HTMLElement | null {
  const story = initialStory?.lastElementChild;
  return story instanceof HTMLElement && story.hasAttribute('data-mx-inline-story') ? story : null;
}
/**
 * Hand the waiting document story to the runtime that hydrates it, once: the
 * story leaves the server's wrapper, and the wrapper (with its handoff rule) is
 * removed. The caller moves the story into the app's tree in the same commit.
 */
export function adoptInitialStory(): HTMLElement | null {
  const story = initialDocumentStory();
  if (story) story.remove();
  clearInitialStory();
  return story;
}

/**
 * The text of the served story's `<style>` — the ONE copy of the document's
 * isolated sheet on an app page that inlined its story (server/app
 * withoutInlinedSheet). Read from the DOM as served, before anything adopts it.
 */
export function initialStorySheet(): string | null {
  const wrapper = servedWrapper();
  if (!wrapper) return null;
  const story = wrapper.lastElementChild;
  // The composition's own `<style>` — its first STYLE child: React may emit resource hints (`<link>`) ahead of it.
  const style = story?.hasAttribute('data-mx-inline-story') ? story.querySelector(':scope > style') : null;
  return style instanceof HTMLStyleElement ? style.textContent : null;
}
