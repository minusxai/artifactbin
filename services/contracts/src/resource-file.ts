import type {DatasetAccessPolicy as DatasetPolicy} from './dataset-grants';
import type {DatasetAccess,ShareEntry,ShareRole,Visibility} from './sharing';

/** Editable identity and settings shared by JSX fences and typed resource files. */
export interface ResourceMetadata {
 id?:string;edit_id?:string;head_version?:number;state?:string;version?:number;
 title?:string|null;description?:string|null;theme?:string|null;template?:string|null;
 colorMode?:'light'|'dark'|null;
 visibility?:Visibility;link?:ShareRole;
 folder?:string|null;shares?:ShareEntry[];
 /** Lineage recorded by fork; written once at first push and never edited. */
 forked_from?:string|null;
}
export const ARTIFACT_RESOURCE_TYPES=['artifact','folder','dataset','file'] as const;
/** Source paths retain their exact spelling and address local workspace bytes. A dataset source is CSV or JSON rows, or a .jsx dataset definition (<Dataset> markup) for connected and multi-table datasets. */
export type ArtifactResourceFile = ResourceMetadata & (
 | {type:'artifact';source?:string}
 | {type:'folder'}
 | {type:'file';source?:string}
 | {type:'dataset';source?:string;access?:DatasetAccess;policy?:DatasetPolicy|null;policy_revision?:number}
);
