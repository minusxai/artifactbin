/** Public provenance only. Reserving an ID does not create this published identity. */
export interface PortableIdentity {
  platformOrigin: string;
  artifactId: string;
  baseRevision: string;
  sourceDigest: string;
  dependencyIdentity?: Readonly<Record<string, string>>;
}
