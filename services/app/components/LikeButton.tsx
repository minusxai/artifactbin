/**
 * THE HEART on a document's toolbar: the count for everyone, the toggle for an
 * account. A click asks `/api/my/artifacts/:id/like` (POST to like, DELETE to
 * unlike) and renders whatever the door answers — the answer IS the state, no
 * optimistic guess to roll back. Anonymous readers get a link to /login.
 */
export function LikeButton(props: { artifactId: string; liked: boolean; count: number; signedIn: boolean }) {
  void props;
  return null; // events-moments: implement
}
