/** Explicit document administration; never a general reader or dataset capability. */
export const ADMIN_DOCUMENT_HEADER = 'X-Artifactbin-Admin';
export interface AdminDocument {
  id:string;
  title:string|null;
  source:string;
  version:number;
  edit_id:string;
}
export interface AdminDocumentList {
  documents:Array<Pick<AdminDocument,'id'|'title'|'version'>>;
  next:string|null;
}
