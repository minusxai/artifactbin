export interface MigratedGroup {
  legacyId: string;
  actor: string;
  active: boolean;
  name: string;
  members: { actor: string; role: "viewer" | "editor" }[];
}
export interface GroupMigrationPlan {
  groups: MigratedGroup[];
  blocked: { legacyId: string; reason: string }[];
}
