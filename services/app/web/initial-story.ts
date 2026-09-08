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
