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
/** Only the first home mount may use the server's public eligibility verdict. */
export function takeInitialHome(): boolean {
  const value = initialHome;
  initialHome = false;
  return value;
}
export function clearInitialStory(): void {
  initialStory?.remove();
  initialStory = null;
}
