import type { Converter } from "./contracts.ts";
export interface ConversionCacheOptions {
  directory: string;
  /** Hash of compiler code and archived build, never path alone. */ compilerIdentity: string;
  strategy: string;
  maxBytes?: number;
}
export interface CachedConverter {
  convert: Converter;
  stats: { hits: number; misses: number; invalid: number };
}
