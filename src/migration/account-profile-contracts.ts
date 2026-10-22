export interface MigrationAccountProfileSummary {
  namesFilled: number;
  namesPreserved: number;
  namesUnavailable: number;
  namesClearedSinceImport: number;
  handlesFilled: number;
  handlesPreserved: number;
  handlesMissing: number;
  handlesInvalid: number;
  handlesColliding: number;
  handlesNonlogin: number;
  handlesAbsentSinceImport: number;
}
