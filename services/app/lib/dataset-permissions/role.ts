/**
 * THE DATASET ROLE of one caller: the dataset's own sharing, read through the access facts, decided by the
 * one total derivation in @artifactbin/contracts (`datasetRoleFrom`). Datasets and resolvers both ask here.
 */
import { datasetRoleFrom, type DatasetRole } from '@artifactbin/contracts';
import type { AccessActor } from '@/lib/accounts';
import { linkRoleOf, liveAccessFacts, reachesAsAccount, roleWithoutLink, type AccessFacts, type ArtifactRow } from '@/lib/artifact-access';

/** The dataset columns a role decision reads. */
export type DatasetRoleRow = Pick<ArtifactRow, 'id' | 'user_id' | 'token_id' | 'visibility' | 'link_role'> & Partial<Pick<ArtifactRow, 'group_id' | 'format'>>;

export interface DatasetRoleOptions {
  /** Where the facts are read: inside a commit transaction, its facts (`liveAccessFacts(actor, tx)`). */
  facts?: AccessFacts;
  /**
   * The caller arrives through a page linking the dataset. Without sharing of their own they get
   * `signed_in` or `anonymous` (never viewer or editor), even when the dataset itself is private.
   */
  throughPage?: boolean;
}

/** Exactly one role, or null (answer the uniform 404). A page link never raises it. */
export async function datasetRole(row: DatasetRoleRow, actor: AccessActor, options: DatasetRoleOptions = {}): Promise<DatasetRole | null> {
  const facts = options.facts ?? liveAccessFacts(actor);
  const held = await roleWithoutLink(row, actor, facts);
  const account = held !== 'owner' && !!actor.userId && await reachesAsAccount(row, actor, facts);
  return datasetRoleFrom({ held, account, linkRole: linkRoleOf(row), visibility: row.visibility, throughPage: !!options.throughPage });
}
