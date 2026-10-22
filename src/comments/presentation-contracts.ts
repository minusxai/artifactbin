/** Trusted read projection only. No account actors, email, display names or invitation details. */
export interface CommentPersonLink {
  readonly legacyUserId: string;
  readonly href: string;
}
export interface CommentBodyPresentation {
  readonly body: string;
  readonly personLinks?: readonly CommentPersonLink[];
}
export const MAX_COMMENT_BODY_CHARACTERS = 10_000;
