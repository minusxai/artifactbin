/** @param {import('./fast-test-contracts').FastCheckBudget} clock */
export function assessFastBudget({ startedAt, now, budgetMs }) {
  const elapsedMs = now - Date.parse(startedAt);
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0 || !Number.isFinite(budgetMs) || budgetMs <= 0) {
    throw new Error('Invalid fast-check clock');
  }
  return { elapsedMs, passed: elapsedMs < budgetMs };
}
