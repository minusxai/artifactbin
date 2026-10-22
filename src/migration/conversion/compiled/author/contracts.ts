/** Offline migration only. No author source is evaluated by these contracts. */
export type Scalar = string | number | boolean | null;
export type AuthorState =
  | Scalar
  | AuthorState[]
  | { [key: string]: AuthorState };
export type Row = Record<string, Scalar>;
export type Accessor<T> = () => T;
export interface SignalOptions<T> {
  name?: string;
  equals?: false | ((previous: T, next: T) => boolean);
}
export type Setter<T> = (next: T | ((previous: T) => T)) => T;
export interface QuerySnapshot {
  rows: Row[];
  loading: boolean;
  error: string | null;
}
export interface QueryPort {
  read(): QuerySnapshot;
  subscribe(listener: () => void): () => void;
}
/** Adapter supplied by the Apollo-backed page boot, never an ambient global. */
export interface AuthorPorts {
  state: {
    read(key: string): AuthorState | undefined;
    write(key: string, value: AuthorState): void;
    subscribe(listener: () => void): () => void;
  };
  query(name: string): QueryPort;
  /** Trusted registered dataset mutation transport; never a generic authored fetch. */
  mutation?(
    name: string,
    args: Readonly<Row>,
    row?: Readonly<Row>,
  ): Promise<unknown>;
}
export interface AuthorNames {
  values: string[];
  tables?: string[];
  queries: string[];
  mutations: string[];
}
export interface QueryAccessor extends Accessor<Row[]> {
  loading: Accessor<boolean>;
  error: Accessor<string | null>;
  readonly ready: Promise<Row[]>;
}
/** Frozen page ABI: commits resolve without a payload, all other outcomes reject. */
export type AuthorMutation = (
  args?: Readonly<Record<string, unknown>>,
) => Promise<void>;
export interface AuthorMutationOptions {
  names: readonly string[];
  adapter: Pick<
    import("../dataset-mutations-contracts.ts").CompiledDatasetMutationAdapter,
    "mutate"
  >;
  authorizationContext(): string | null;
}
export interface AuthorBindings {
  signal(ref: string): [Accessor<Scalar>, Setter<Scalar>];
  query(ref: string): QueryAccessor;
  mutation(ref: string): AuthorMutation;
  createSignal<T>(
    value: T,
    options?: SignalOptions<T>,
  ): [Accessor<T>, Setter<T>];
  mount<T>(identity: string, render: () => T): T;
  dispose(): void;
}
export interface ReactivePort {
  signal<T>(value: T, options?: SignalOptions<T>): [Accessor<T>, Setter<T>];
  untrack<T>(read: () => T): T;
  identity(): string | null;
  scope<T>(identity: string, render: () => T): T;
}
export interface AuthorCompilation {
  code: string;
  exports: string[];
}

/** Virtual source modules for integration into the kit's one pinned Solid bundle. */
export interface AuthorBundleSources {
  entry: string;
  authorModule: string;
  closureModule: string;
  exports: string[];
  solidRoot: string;
}
