import type { BrowserEngine, CIBrowserRuntimePlan, CIBrowserRuntimeOperations } from "./contracts.ts";
export function browserRuntimePlan(engines: readonly BrowserEngine[]): CIBrowserRuntimePlan {
  const selected = [...new Set(engines)].sort();
  return { kind: selected.length === 0 ? "none" : selected.includes("webkit") ? "image" : "host", engines: selected };
}
export async function provisionBrowserRuntime(plan: CIBrowserRuntimePlan, version: string, operations: CIBrowserRuntimeOperations): Promise<void> {
  if (version !== "1.56.1") throw Error("Update the matching CI browser runtime");
  if (plan.kind === "none") return;
  if (plan.kind === "image") return operations.run(["image"]);
  await operations.run(["install", ...plan.engines]);
  const prove = async () => { for (const engine of plan.engines) await operations.smoke(engine); };
  try { await prove(); }
  catch (error) {
    if (!/Host system is missing dependencies|error while loading shared libraries|cannot open shared object file/.test(String(error))) throw error;
    await operations.run(["install-deps", ...plan.engines]);
    await prove();
  }
}
