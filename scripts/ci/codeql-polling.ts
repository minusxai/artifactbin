import { assertCodeQLUpload } from "./codeql-upload.ts";
import type {
  CodeQLUploadExpectation,
  CodeQLUploadPollingOperations,
  CodeQLUploadPollingOptions,
  CodeQLUploadPollingResult,
} from "./contracts.ts";

export async function waitForCodeQLUpload(
  expected: CodeQLUploadExpectation,
  operations: CodeQLUploadPollingOperations,
  {
    timeoutMs = 180_000,
    intervalMs = 5_000,
  }: Partial<CodeQLUploadPollingOptions> = {},
): Promise<CodeQLUploadPollingResult> {
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs <= 0 ||
    !Number.isSafeInteger(intervalMs) ||
    intervalMs <= 0
  )
    throw Error("Invalid CodeQL processing polling limits");
  const start = operations.now(),
    deadline = start + timeoutMs;
  const remaining = () => {
    const milliseconds = deadline - operations.now();
    if (milliseconds <= 0)
      throw Error(
        "CodeQL stored analysis verification exceeded its processing deadline",
      );
    return milliseconds;
  };
  let polls = 0;
  while (true) {
    const status = await operations.status(remaining());
    polls++;
    remaining();
    if (
      !status ||
      typeof status !== "object" ||
      !("processing_status" in status)
    )
      throw Error("Malformed CodeQL processing status");
    const state = status as { processing_status: unknown; errors?: unknown };
    const errorsEmpty =
      state.errors === null ||
      (Array.isArray(state.errors) && state.errors.length === 0);
    if (
      state.processing_status === "failed" ||
      (state.errors !== undefined && !errorsEmpty)
    )
      throw Error("CodeQL upload processing failed");
    if (state.processing_status === "complete") {
      if (!errorsEmpty)
        throw Error("Malformed completed CodeQL processing status");
      const analyses = await operations.analyses(remaining());
      remaining();
      if (!Array.isArray(analyses))
        throw Error("Malformed CodeQL stored analyses");
      // The SARIF index can become complete before its analysis record appears.
      // Existing records must satisfy every identity/rule/error invariant now;
      // only an absent record remains eligible for another bounded poll.
      if (analyses.length) {
        assertCodeQLUpload(status, analyses, expected);
        return { polls, elapsedMs: operations.now() - start };
      }
    } else if (state.processing_status !== "pending")
      throw Error("Unknown CodeQL processing status");
    await operations.sleep(Math.min(intervalMs, remaining()));
  }
}
