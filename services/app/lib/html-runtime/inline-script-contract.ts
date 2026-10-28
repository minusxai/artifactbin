/** An additional document policy: exact initial code only, never an origin grant. */
export interface InlineScriptAdmission {
  scriptHashes: readonly string[];
  handlerHashes: readonly string[];
  /** Intersects with the existing hosted header; portable packaged modules retain data URLs. */
  policy: string;
}
