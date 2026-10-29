/** The trust module's interface: what code outside lib/trust imports (rule 4, scripts/ci/module-graph.mjs). */
export {
  allowDocument, carriedTrust, cspExtensionsFor, cspRequestFor, declaredCspExtensions, denyDocument, extensionsHash, hostsPublishedBy,
  revokeTrust, sessionTrustCookie,
} from './document-trust';
export { nativeCspDeclarations } from './native-csp';
