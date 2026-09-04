/**
 * FOLLOW on a public profile: the count for everyone, the toggle for an
 * account, `/api/users/:id/follow` (POST / DELETE), the answer is the state.
 * Anonymous readers get a link to /login. Never rendered on the owner's own
 * listing.
 */
export function FollowButton(props: { userId: string; following: boolean; count: number; signedIn: boolean }) {
  void props;
  return null; // events-moments: implement
}
