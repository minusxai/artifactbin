/** Trusted visual-revision alias only. Normal capability publication never accepts it.
 * The digest seals the original descriptor with this field removed and its original owner version restored. */
export interface VisualReceiptIdentity {
  kind: "visual-revision-receipt-v1";
  pageVersion: number;
  descriptorSha256: string;
}
