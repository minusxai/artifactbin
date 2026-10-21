import type { TestConcurrencyResources, TestDescriptor } from "./contracts.ts";

/** Keep infrastructure stages conservative; pure local tests can use more CPUs. */
export function testConcurrency(
  tests: readonly TestDescriptor[],
  resources: TestConcurrencyResources,
): number {
  const pureLocal =
    !resources.ci && tests.every((test) => test.capability === "unit");
  return Math.max(
    1,
    Math.min(resources.availableParallelism, pureLocal ? 8 : 2),
  );
}
