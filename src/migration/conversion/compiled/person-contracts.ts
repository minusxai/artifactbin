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
  watch(
    binding: CompiledPersonBinding,
    userId: string,
    next: (card: unknown) => void,
    error: () => void,
  ): () => void;
  changed(cards: Readonly<Record<string, CompiledPersonCard>>): void;
}
