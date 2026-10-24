import { canRead, canAnnotate, type ArtifactRole } from '@artifactbin/contracts';

/** Reading a conversation follows document admission; writing also needs an account and a live head. */
export interface CommentAccess {
  canReadComments: boolean;
  canCreateComment: boolean;
}
export function commentAccess(role: ArtifactRole, signedIn: boolean, archived: boolean): CommentAccess {
  return { canReadComments: canRead(role), canCreateComment: signedIn && !archived && canAnnotate(role) };
}
