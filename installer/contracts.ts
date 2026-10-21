/** Installer-only contract; no page publishing or account-token handling. */
export interface InstallOptions {
  home: string;
  origin: string;
  archive: Uint8Array;
}
export interface InstalledSkill {
  folder: string;
  name: "artifactbin-author";
}
