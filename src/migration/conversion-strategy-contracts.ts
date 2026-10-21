import type {ArchivedCompilerPort} from './conversion/compiled/contracts.ts';
export type MigrationConversionStrategy='strict'|'archived-static';
export interface MigrationConversionOptions {
 strategy:MigrationConversionStrategy;
 /** Explicit opt-in path; never discovered or used as a fallback. */
 legacyRoot?:string;
 compiler?:ArchivedCompilerPort;
}
