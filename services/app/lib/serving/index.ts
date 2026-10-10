/** The serving module's interface: only what other modules import. */
export { agentContract } from './agent-contract';
export { existingPaste } from './agent-copy';
export { agentBlurb } from './agent-discovery';
export { APP_SHELL_FONT_PRELOADS } from './app-fonts';
export { archivedReadOnly, archivedVersionFor, servedRow } from '@/lib/artifacts';
export { artifactPageAnswer, artifactPageResponse } from './artifact-page';
export type { ArtifactPageAnswer } from './artifact-page';
export { artifactAppIcon, artifactManifest, artifactPwaEnabled, readableApp, withArtifactAppHead } from './artifact-pwa.server';
export { artifactAppPath } from './artifact-pwa';
export { DOMAIN_HOME_CSP, linkedStylesheets, renderDomainHome } from './custom-domain-home';
export type { ProfileListingData } from './custom-domain-home';
export { attachDomain, canonicalDocumentUrl, customHostCandidate, domainHomepage, domainHomepageOptions, setDomainHomepage, domainOf, domainResolver, isServable, normalizeHostname, ownerForHost, recheckDomains, removeDomain, servesDocument, servesEmbeddedArtifact, servesWebAsset, setDomainResolver, startDomainRecheck, verifiedHostOf, verifyDomain } from './custom-domains';
export { domainPath, setDomainPath } from './custom-domains';
export type { CaaRecord, DomainResolver } from './custom-domains';
export { GITHUB_EXTERNAL_URL } from './github-star';
export { publicRefAsset, publicRefAssetResponse } from './public-ref-assets';
export { REPO_URL } from './repo';
export { THEME_BOOTSTRAP_HASH, THEME_BOOTSTRAP_SCRIPT } from './theme-bootstrap';
