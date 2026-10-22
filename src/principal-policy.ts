/** Archival ownership/selector identities are deliberately not claimable login accounts. */
export function isLegacyNonloginActor(actor: string): boolean {
  return /^legacy-(?:user|token|orphan):[a-f0-9]{64}$/.test(actor);
}
