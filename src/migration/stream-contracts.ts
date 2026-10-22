import type {LegacyRow,SqlReader} from './contracts.ts';
export interface StreamPart {table:string;path:string;rows:number;bytes:number;sha256:string}
export interface StreamManifest {schemaVersion:2;sourceNamespace:string;schema:string;exportedAt:string;parts:StreamPart[]}
export interface StreamExportOptions {schema:string;sourceNamespace:string;directory:string;now:()=>Date;batchRows?:number;partBytes?:number;signal?:AbortSignal}
export interface StreamArchiveDestination {
 /** Must atomically insert a part and its digest receipt; replay same digest is a no-op. */
 archivePart(namespace:string,part:StreamPart,rows:AsyncIterable<LegacyRow>):Promise<'created'|'unchanged'>;
}
export type StreamSql=SqlReader;

/** Bounded wire batches; an individual oversized record is sent alone. */
export interface StreamArchiveBatchOptions {batchRows?:number;batchBytes?:number}
