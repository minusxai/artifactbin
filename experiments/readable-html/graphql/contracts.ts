import type { ExecutionResult } from "graphql";
export type Json =
  | null
  | boolean
  | number
  | string
  | Json[]
  | { [key: string]: Json };
export interface Snapshot {
  version: number;
  revision: number;
  state: Json;
}
export type Resolver = (state: any, args: Record<string, any>) => unknown;
export interface StoreOptions {
  sdl: string;
  initial: Json;
  version: number;
  queries: Record<string, Resolver>;
  mutations: Record<string, Resolver>;
}
export interface Store {
  query(source: string, variables?: Record<string, unknown>): ExecutionResult;
  mutate(source: string, variables?: Record<string, unknown>): ExecutionResult;
  watch(
    source: string,
    callback: (result: ExecutionResult) => void,
    variables?: Record<string, unknown>,
  ): () => void;
  snapshot(): Snapshot;
  dispose(): void;
}
export type RemoteStatus = "committed" | "rejected" | "offline" | "unknown";
export interface RemoteReceipt {
  status: RemoteStatus;
  result?: ExecutionResult;
  reason?: string;
}
export interface RemoteOptions {
  sdl: string;
  online(): boolean;
  resolvers: Record<
    string,
    (args: Record<string, any>, signal: AbortSignal) => Promise<unknown>
  >;
}
export interface RemoteOperation {
  status: "pending";
  settled: Promise<RemoteReceipt>;
  cancel(): void;
}
export interface OperationDefinition {
  location: "local" | "remote";
  source: string;
}
export interface App {
  query(source: string, variables?: Record<string, unknown>): ExecutionResult;
  execute(name: string, variables?: Record<string, unknown>): RemoteOperation;
}
