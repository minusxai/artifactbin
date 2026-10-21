/** Evidence is scoped to candidate integration, never deployed production. */
export interface AcceptanceReceipt {
  engine: 'chromium' | 'firefox' | 'webkit';
  localRevision: string;
  editedRevision: string;
  offlineRevision: string;
  samplesMs: number[];
  throttledSamplesMs?: number[];
  runtimeBytes: number;
  gzipBytes: number;
  tlsVerified: boolean;
  assertions: string[];
}
/** Portable immutable comment context; source revision must match decoded source. */
export interface PortableContext {
  id: string;
  sourceRevision: string;
  source: string;
  targetId: string;
  body: string;
  snapshot: import('../source/contracts.ts').Json;
}
export interface ContextProof {
  installContext(context: PortableContext): Promise<void>;
  enterComment(id: string): import('../replay/contracts.ts').ReplayDocument;
}
