/** Server-owned sibling captured before author DOM is mounted into the SPA. */
let initialStory: Element | null = null;
let initialPath = '';
export function captureInitialStory(): void {
  const candidate = document.body.lastElementChild;
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
  const wrapper = document.body.lastElementChild;
  if (!wrapper?.hasAttribute('data-mx-initial-story')) return null;
  const style = wrapper.lastElementChild?.hasAttribute('data-mx-inline-story') ? wrapper.lastElementChild.firstElementChild : null;
  return style instanceof HTMLStyleElement ? style.textContent : null;
}
