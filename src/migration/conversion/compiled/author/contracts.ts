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
/** Viewer-owned operations only; never contains a remote adapter or access grant. */
export interface AuthorLocalMutationOptions {
  names: readonly string[];
  mutate(name:string,args:Readonly<import("../../../../author/contracts.ts").Row>,row?:Readonly<import("../../../../author/contracts.ts").Row>):Promise<unknown>;
}
