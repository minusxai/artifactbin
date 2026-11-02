/** Anonymous copies of eligible documents, scoped to their live user or group owner. */
export {isUserPagesHost,userPagesLabel,handleFromLabel,handleFromUserPagesHost,userPagesOrigin,ownerForHandle,documentOwner} from './hosts';
export type {UserPagesOwner} from './hosts';
export {eligibleDocument,servesDocument,servesEmbeddedArtifact,servesWebAsset,canonicalDocumentUrl,userPageUrl,userPageUrlForOwner,publicHomeFiles} from './serving';
export {DOMAIN_HOME_CSP,linkedStylesheets,renderDomainHome} from './home';
export type {ProfileListingData} from './home';
