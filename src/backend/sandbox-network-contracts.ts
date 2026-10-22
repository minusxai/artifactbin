export interface SandboxNetworkOptions {
  network: string;
  identity: { namespace: string; network: string; bridge: string };
  command(
    args: readonly string[],
    timeoutMs: number,
  ): Promise<{ stdout: string }>;
  log(message: string): void;
}
export interface SandboxNetwork {
  /** Coalesce verification; failed attempts never become trusted and may retry. */
  ensure(): Promise<void>;
  /** Forget a verified bridge after Docker reports its removal. */
  invalidate(): void;
}
