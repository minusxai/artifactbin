import type {DatasetPolicy} from './dataset-policy';
import type {ShareEntry} from './sharing';

/** Editable identity and settings shared by JSX fences and typed resource files. */
export interface ResourceMetadata {
 id?:string;edit_id?:string;head_version?:number;state?:string;version?:number;
 title?:string|null;description?:string|null;theme?:string|null;template?:string|null;
 colorMode?:'light'|'dark'|null;
 visibility?:'private'|'unlisted'|'public';link?:'viewer'|'commenter'|'editor';
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
 | {type:'dataset';source?:string;access?:'read'|'readwrite';policy?:DatasetPolicy|null;policy_revision?:number}
);
