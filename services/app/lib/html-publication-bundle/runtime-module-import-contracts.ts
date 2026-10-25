/** Closed, nonescaping adapters for runtime-created URLs have no project-file dependency. */
export interface RuntimeModuleImportAdmission {
  importStart: number;
  argumentStart: number;
  argumentEnd: number;
  replacement: string;
}
