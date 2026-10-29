/**
 * WHAT A TOKEN CLAIM OR A GUEST MERGE DOES TO ARTIFACTS. Both are account acts (they attach credentials and
 * retire a guest), and both must move the artifacts the credential or guest owned in the SAME transaction.
 * The artifacts table is lib/artifacts', and lib/artifacts imports this module, so accounts cannot call it:
 * lib/artifacts installs its adopter here when it loads (artifacts/owner-adoption). A claim or merge with
 * nothing installed throws before writing, never attaches a token without what it published.
 */
import type { Queryable } from '../platform/db';

export interface ArtifactAdopter {
  /** Every artifact the guest owns becomes the account's. */
  fromGuest(tx: Queryable, guestId: string, userId: string): Promise<void>;
  /** The token's artifacts that no user or group owns become the user's; answers how many. */
  fromToken(tx: Queryable, tokenId: string, userId: string): Promise<number>;
}

let installed: ArtifactAdopter | null = null;

/** Install (or, for a test, remove) the adopter; answers the one it replaced. */
export function installArtifactAdopter(adopter: ArtifactAdopter | null): ArtifactAdopter | null {
  const previous = installed;
  installed = adopter;
  return previous;
}

export function artifactAdopter(): ArtifactAdopter {
  if (!installed) throw new Error('No artifacts adopter is installed: load lib/artifacts before claiming tokens or merging guests');
  return installed;
}
