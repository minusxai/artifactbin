/**
 * @param {string} startedAt
 * @param {string} observedAt
 * @param {number} [budgetSeconds]
 * @returns {import("./contracts.ts").WorkflowTiming}
 */
export function workflowTiming(startedAt, observedAt, budgetSeconds = 120) {
  const start = Date.parse(startedAt), end = Date.parse(observedAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start || !Number.isFinite(budgetSeconds) || budgetSeconds <= 0) throw Error("Invalid workflow timing");
  const elapsedSeconds = (end - start) / 1000;
  return { startedAt, observedAt, elapsedSeconds, budgetSeconds, withinBudget: elapsedSeconds <= budgetSeconds };
}
