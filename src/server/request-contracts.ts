/** API commands accept a JSON object; absent bodies are an empty command. */
export interface RequestBody {
  [field: string]: unknown;
}
/** Exact file endpoint path, before dispatch or authorization. */
export interface FileRoute {
  readonly fileId: string;
  readonly parts: readonly string[];
}
