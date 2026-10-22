/** Public routing metadata only. The server retains all source/column authority. */
export interface CompiledPersonBinding {
  valueName: string;
  backendNamespace: string;
}
export interface CompiledPersonCard {
  name: string;
  handle: string | null;
  image: string | null;
}
export interface CompiledPersonPorts {
  /** Only authoritative receipts from canonical watchQuery reach next/error. */
  watch(
    binding: CompiledPersonBinding,
    userId: string,
    next: (card: unknown) => void,
    error: () => void,
  ): () => void;
  /** Credential-free bridge only; no direct fetch from page scripts. */
  image?(address: string, signal: AbortSignal): Promise<Blob>;
  objectUrls?: { create(blob: Blob): string; revoke(url: string): void };
  changed(cards: Readonly<Record<string, CompiledPersonCard>>): void;
}
/** Offline source consumer classification only; never a profile authorization. */
export type ReadLegacyPersonValueNames = (source: string) => readonly string[];
