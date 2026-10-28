/** A fast test is explicitly enrolled and its complete resolved module graph is capability checked. */
export interface FastTestGraph {
  inputs: Record<string, { imports: { path: string; external?: boolean; kind: string }[] }>;
}
export interface FastTestClassification {
  eligible: boolean;
  reasons: string[];
}

export interface FastCheckBudget {
  startedAt: string;
  now: number;
  budgetMs: number;
}
