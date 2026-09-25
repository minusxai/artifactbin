/**
 * THE SOCIAL HEADER of a public profile, as X draws it: both counts for
 * everyone; for a signed-in stranger, whether each follows the other and the
 * people they follow who also follow this profile. The owner and anonymous
 * readers get the counts alone — there is no relationship to describe.
 */
import { avatarUrl } from '@/lib/avatars';
import { count, countLinked, followersYouKnow, has } from '@/lib/relations';

/** How many followers-you-know are named; the rest are counted. */
export const KNOWN_FOLLOWERS_SHOWN = 3;

export interface ProfileSocial {
  followers: number;
  following: number;
  /** How a signed-in viewer who is not the owner relates to them; absent for the owner and anonymous readers. */
  relation?: ProfileRelation;
}

export interface ProfileRelation {
  youFollow: boolean;
  followsYou: boolean;
  /** Up to KNOWN_FOLLOWERS_SHOWN of the people you follow who follow them, newest first. */
  known: Array<{ id: string; username: string; image: string | null }>;
  /** All of them, named or not. */
  knownTotal: number;
}

export async function profileSocial(ownerId: string, viewerId: string | null): Promise<ProfileSocial> {
  const [followers, following] = await Promise.all([count('follow', ownerId), countLinked(ownerId, 'follow')]);
  if (!viewerId || viewerId === ownerId) return { followers, following };
  const [youFollow, followsYou, known] = await Promise.all([
    has(viewerId, 'follow', ownerId),
    has(ownerId, 'follow', viewerId),
    followersYouKnow(viewerId, ownerId, KNOWN_FOLLOWERS_SHOWN),
  ]);
  return {
    followers,
    following,
    relation: {
      youFollow,
      followsYou,
      known: known.users.map((u) => ({ id: u.id, username: u.username, image: avatarUrl(u) })),
      knownTotal: known.total,
    },
  };
}
