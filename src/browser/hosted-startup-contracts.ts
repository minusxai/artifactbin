/** Hosted startup stays visible until the isolated app supplies its first view. */
export interface HostedStartup {
  ready(): void;
  fail(): void;
}
export interface HostedStartupClock {
  setTimeout(callback: () => void, delay: number): number;
  clearTimeout(timer: number): void;
}
