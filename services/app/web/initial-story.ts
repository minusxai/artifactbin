/** Server-owned sibling captured before author DOM is mounted into the SPA. */
let initialStory: Element | null = null;
let initialPath = '';
let initialHome = false;
export function captureInitialStory(): void {
  const candidate = document.body.lastElementChild;
  initialHome = !!candidate?.hasAttribute('data-mx-initial-home');
  initialStory = candidate?.hasAttribute('data-mx-initial-story') || initialHome ? candidate : null;
  initialPath = window.location.pathname;
}
/** Clear the captured server sibling before an app-route commit can paint. */
export function clearInitialStoryOnRoute(pathname: string): void {
  if (pathname !== initialPath) { initialHome = false; clearInitialStory(); }
}
/** Render may restart before commit; reading eligibility must not consume it. */
export function hasInitialHome(): boolean { return initialHome; }
export function clearInitialStory(): void {
  initialHome = false;
  initialStory?.remove();
  initialStory = null;
}
