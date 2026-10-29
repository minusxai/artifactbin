/**
 * The artifacts half of a token claim and a guest merge (lib/accounts artifact-adoption), installed when this
 * module loads: lib/accounts runs them inside its own transaction, beside its token and user writes.
 */
import { installArtifactAdopter } from '@/lib/accounts';

installArtifactAdopter({
  async fromGuest(tx, guestId, userId) {
    await tx.query('UPDATE artifacts SET user_id = $1 WHERE user_id = $2', [userId, guestId]);
  },
  async fromToken(tx, tokenId, userId) {
    return (await tx.query('UPDATE artifacts SET user_id = $1 WHERE token_id = $2 AND user_id IS NULL AND group_id IS NULL', [userId, tokenId])).rowCount;
  },
});
