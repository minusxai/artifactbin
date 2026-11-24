/** Anonymous copies of eligible documents, scoped to their live user or group owner. */
export {isUserPagesHost,userPagesLabel,handleFromLabel,handleFromUserPagesHost,userPagesOrigin,ownerForHandle,documentOwner} from './hosts';
export type {UserPagesOwner} from './hosts';
export {eligibleDocument,servesDocument,servesEmbeddedArtifact,servesWebAsset,canonicalDocumentUrl,userPageUrl,userPageUrlForOwner,publicHomeFiles,homePageId} from './serving';
export {DOMAIN_HOME_CSP,linkedStylesheets,siteFilePath,renderDomainHome} from './home';
export type {ProfileListingData} from './home';
export {validSiteLabel,websiteSettings,saveSiteRoot,deleteSiteRoot,publicSiteAncestors,hasPublicSiteAncestors,siteAddress,siteOwner,inSiteScope} from './site-roots';
