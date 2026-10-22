import type {DatasetImportMetadata} from "../datasets/import-contracts.ts";
import type {LegacyArtifact} from "./contracts.ts";
import type {MigrationJobSource} from "./job-contracts.ts";
import type {MigrationOwnershipOverride} from "./ownership-override-contracts.ts";
import {originalMigrationOwner,resolveMigrationOwnership} from "./ownership-override.ts";
/** Align only an attested reassignment with existing original user authority. */
export type ProjectMigrationDatasetOwnership=(metadata:DatasetImportMetadata,artifact:LegacyArtifact,source:Pick<MigrationJobSource,"base"|"maps"|"manifest">,policy?:MigrationOwnershipOverride)=>DatasetImportMetadata;
export const projectMigrationDatasetOwnership:ProjectMigrationDatasetOwnership=(metadata,artifact,source,policy)=>{
 const {ownershipAssignment}=resolveMigrationOwnership(artifact,source.manifest.sourceNamespace,originalMigrationOwner(artifact,source.manifest.sourceNamespace,source.maps),policy);
 if(!ownershipAssignment)return metadata;
 const target=ownershipAssignment.assignedOwner.id;
 const candidates=(source.base.tables.users??[]).filter(user=>typeof user.email==='string'&&user.email.trim().toLowerCase()===target&&!user.merged_into_user_id&&user.kind==='user'&&source.maps.users[String(user.id)]===target);
 if(candidates.length!==1)throw Error('Ownership assignment requires one canonical source user');
 const userId=String(candidates[0]!.id);
 if(!metadata.principals.some(principal=>principal.kind==='user'&&principal.legacyId===userId&&principal.actor===target))throw Error('Ownership assignment canonical dataset principal unavailable');
 return {...metadata,pages:metadata.pages.map(page=>{
  if(page.snapshot.id!==artifact.id)return page;
  if(page.pageVersion!==artifact.version||page.snapshot.editId!==artifact.edit_id)throw Error('Ownership assignment dataset page identity mismatch');
  return {...page,snapshot:{...page.snapshot,owner:{userId,tokenId:null},ownerIsTestUser:false}};
 })};
};
