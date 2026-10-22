import type {
  LiveInvalidationOptions,
  LiveInvalidationReader,
  LiveInvalidationConsumer,
} from "../live-invalidation-contracts.ts";
export interface ServiceListeningPort {
  once(event: "listening", listener: () => void): unknown;
  off(event: "listening", listener: () => void): unknown;
}
export interface ServiceDisposalPort {
  close(): unknown;
}
export interface ServiceLifecycleOptions {
  server: ServiceListeningPort;
  invalidationReaders: readonly (() => LiveInvalidationReader)[];
  live: ServiceDisposalPort & {
    changedAndWait(pageId: string): void | Promise<void>;
  };
  runners: ServiceDisposalPort;
  backend?: { close?(): unknown };
  datasets: ServiceDisposalPort;
  repository: ServiceDisposalPort;
}
export type ServiceInvalidationFactory = (
  options: LiveInvalidationOptions,
) => LiveInvalidationConsumer;
export interface ServiceLifecycle {
  /** Stop startup synchronously, settle every owned resource, then close persistence. */
  close(): Promise<void>;
}
