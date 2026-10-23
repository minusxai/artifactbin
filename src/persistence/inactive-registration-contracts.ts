/** Internal offline registration proof. Producers verify raw archive admission before construction. */
export interface InactivePageRegistration {
  kind: "inactive-page-registration-v1";
  pageId: string;
  pageVersion: number;
  deletedAt: number;
  sourceNamespace: string;
  artifactSha256: string;
  admissionSha256: string;
}
