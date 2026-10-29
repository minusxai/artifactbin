/**
 * The words before the artifactbin link in a custom domain's attribution line: the domain home
 * (app lib/serving/custom-domain-home) and every domain post (app lib/publish/prepared/serve.server
 * domainFooter, styled by lib/page-styles/document-styles DOMAIN_FOOTER_CSS) print the same line.
 */
export const DOMAIN_FOOTER_TEXT = 'Made with';

/**
 * What a custom domain answers a page's write with: the domain only reads, as a signed-out viewer. The page's own
 * runtime (app lib/html-runtime/domain-reads) and the domain's GraphQL door (app server/custom-host) say the same.
 */
export const DOMAIN_READ_ONLY_MESSAGE = 'Sign in on artifactbin to make changes';
