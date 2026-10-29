/**
 * The custom-domains module's interface: an owner's own hostname — attaching and verifying it, which owner a
 * request host serves and what it may serve there (its homepage, exact paths, embedded artifacts and web assets),
 * the canonical address of a copy, and the domain's home listing.
 */
export { attachDomain, canonicalDocumentUrl, customHostCandidate, domainHomepage, domainHomepageOptions, domainOf, domainPath, domainResolver, isServable, normalizeHostname, ownerForHost, recheckDomains, removeDomain, servesDocument, servesEmbeddedArtifact, servesWebAsset, setDomainHomepage, setDomainPath, setDomainResolver, startDomainRecheck, verifiedHostOf, verifyDomain } from './domains';
export type { CaaRecord, DomainResolver } from './domains';
export { DOMAIN_HOME_CSP, linkedStylesheets, renderDomainHome } from './domain-home';
export type { ProfileListingData } from './domain-home';
