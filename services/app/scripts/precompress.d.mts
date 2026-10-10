export interface PrecompressReport { files: number; source: number; br: number; gzip: number }
export declare function precompressFile(file: string): Promise<{ source: number; br: number; gzip: number } | null>;
export declare function precompressTree(dir: string): Promise<PrecompressReport>;
export declare function describePrecompression(label: string, report: PrecompressReport): string;
