import type {
  CodeQLStoredAnalysis,
  CodeQLUploadExpectation,
} from "./contracts.ts";
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

export function assertCodeQLUpload(
  status: unknown,
  analyses: unknown,
  expected: CodeQLUploadExpectation,
): void {
  if (
    !object(status) ||
    status.processing_status !== "complete" ||
    !(
      status.errors === null ||
      (Array.isArray(status.errors) && status.errors.length === 0)
    )
  )
    throw Error("CodeQL upload processing is incomplete or failed");
  if (
    !Array.isArray(analyses) ||
    analyses.length !== 1 ||
    !Number.isInteger(expected.rules) ||
    expected.rules <= 0
  )
    throw Error("CodeQL stored analysis is missing or has no expected rules");
  let rules = 0;
  for (const value of analyses) {
    if (
      !object(value) ||
      !object(value.tool) ||
      value.tool.name !== "CodeQL" ||
      value.sarif_id !== expected.sarifId ||
      value.commit_sha !== expected.sha ||
      value.ref !== expected.ref ||
      value.category !== expected.category ||
      value.error !== "" ||
      !Number.isInteger(value.rules_count) ||
      Number(value.rules_count) <= 0
    )
      throw Error(
        "CodeQL stored analysis does not match the successful checked upload",
      );
    rules += (value as unknown as CodeQLStoredAnalysis).rules_count;
  }
  if (rules !== expected.rules)
    throw Error(
      "CodeQL stored analysis rule count differs from exported SARIF",
    );
}

export function exportedCodeQLRules(sarif: unknown): number {
  if (!object(sarif) || !Array.isArray(sarif.runs) || sarif.runs.length === 0)
    throw Error("Missing CodeQL SARIF runs");
  let count = 0;
  for (const run of sarif.runs) {
    if (!object(run) || !object(run.tool) || !object(run.tool.driver))
      throw Error("Malformed CodeQL SARIF tool");
    const components = [
      run.tool.driver,
      ...(Array.isArray(run.tool.extensions) ? run.tool.extensions : []),
    ];
    const ids = new Set<string>();
    for (const component of components) {
      if (!object(component) || !Array.isArray(component.rules)) continue;
      for (const rule of component.rules) {
        if (!object(rule) || typeof rule.id !== "string" || !rule.id)
          throw Error("Malformed CodeQL SARIF rule");
        ids.add(rule.id);
      }
    }
    count += ids.size;
  }
  if (!count) throw Error("CodeQL SARIF contains no exported rules");
  return count;
}
