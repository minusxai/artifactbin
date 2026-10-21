/** Every discovered test file, which CI shards partition. */
export interface CheckInventory {
  testFiles: string[];
}
export interface WorkflowTiming {
  startedAt: string;
  observedAt: string;
  elapsedSeconds: number;
  budgetSeconds: number;
  withinBudget: boolean;
}
export type BrowserEngine = "chromium" | "firefox" | "webkit";
export interface CISetupRequirements {
  postgres: boolean;
  browsers: BrowserEngine[];
  backend: boolean;
}
export interface BackendContextFingerprintOptions {
  root: string;
  platform: string;
  architecture: string;
}
export interface DeploymentGateContext {
  github: { ref: string; event_name: string };
  inputs: { "codeql-proof-only": boolean };
  needs: Record<
    "fast" | "security" | "node",
    {
      result: "success" | "failure" | "cancelled" | "skipped";
    }
  >;
}
export interface CIBrowserRuntimePlan {
  kind: "none" | "host" | "image";
  engines: BrowserEngine[];
}
export interface CIBrowserRuntimeOperations {
  run(args: string[]): Promise<void>;
  smoke(engine: BrowserEngine): Promise<void>;
}
export interface CodeQLPartition {
  shard: "a" | "b" | "c";
  filter: "exclude";
  pattern: string;
}
export interface CodeQLQueryCoverage {
  defaultQueries: string[];
  shardA: string[];
  shardB: string[];
  shardC: string[];
}
export interface CodeQLUploadExpectation {
  sarifId: string;
  sha: string;
  ref: string;
  category: string;
  rules: number;
}
export interface CodeQLStoredAnalysis {
  sarif_id: string;
  commit_sha: string;
  ref: string;
  category: string;
  error: string;
  rules_count: number;
  tool: { name: string };
}
export interface CodeQLUploadPollingOperations {
  now(): number;
  sleep(milliseconds: number): Promise<void>;
  status(timeoutMs: number): Promise<unknown>;
  analyses(timeoutMs: number): Promise<unknown>;
}
export interface CodeQLUploadPollingOptions {
  timeoutMs: number;
  intervalMs: number;
}
export interface CodeQLUploadPollingResult {
  polls: number;
  elapsedMs: number;
}
