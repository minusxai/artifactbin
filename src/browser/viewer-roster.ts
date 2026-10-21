import type { Viewer } from "../contracts.ts";
/** Profile refresh and people controls depend on membership and view consent, not pointer motion. */
export function sameViewerRoster(
  a: readonly Viewer[],
  b: readonly Viewer[],
): boolean {
  return (
    a.length === b.length &&
    a.every((viewer, index) => {
      const other = b[index]!;
      return (
        viewer.sessionId === other.sessionId &&
        viewer.actor === other.actor &&
        viewer.shareView === other.shareView
      );
    })
  );
}
