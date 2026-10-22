export interface MigrationReadinessRow {
  pageId: string;
  ready: boolean;
  dependencies: readonly string[];
  assets?: readonly string[];
}
export interface MigrationReadiness {
  ready: string[];
  blocked: Record<string, string[]>;
}
