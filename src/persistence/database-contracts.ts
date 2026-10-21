import type { IdentityRepository } from "../server/identity-repository-contracts.ts";
import type { CollaborationRepository } from "../server/collaboration-contracts.ts";
import type { CommentRepository } from "../server/comment-repository-contracts.ts";
/** Composition of semantic persistence ports; no generic state transaction is exposed. */
export interface DatabaseRepository {
  identity: IdentityRepository;
  collaboration: CollaborationRepository;
  comments: CommentRepository;
  catalog: import("./document-catalog-contracts.ts").DocumentCatalog;
  paths: import("./path-catalog-contracts.ts").PathCatalog;
  health(): Promise<void>;
  close(): Promise<void>;
}
