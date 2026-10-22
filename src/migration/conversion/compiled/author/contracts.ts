export * from "../../../../author/contracts.ts";
export interface AuthorMutationOptions {
  names: readonly string[];
  adapter: Pick<
    import("../dataset-mutations-contracts.ts").CompiledDatasetMutationAdapter,
    "mutate"
  >;
  authorizationContext(): string | null;
  access?: {
    read(): import("../../../../apollo/apollo-contracts.ts").RemoteAccessSnapshot;
    subscribe(listener: () => void): () => void;
  };
}
