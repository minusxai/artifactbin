/** Evidence boundary only: this candidate joins the separately specified phase modules. */
export interface ComposedScenarios {
  /** One immutable schema/backend version crosses real GraphQL, workerd and PostgreSQL. */
  remoteWrite: 'committed' | 'unknown';
  /** Local optimistic state is reversible until an authoritative receipt and snapshot agree. */
  replicaWrite: 'accepted' | 'rejected';
  /** An acknowledged or retried command produces one transactional intent record. */
  effectsPerAcceptedCommand: 1;
}
