import type { SharingPreferences } from "../contracts.ts";
/** Viewer-only storage, separate from document state and exported HTML. */
export interface ReaderPreferenceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
export interface ReaderPreferences {
  read(): SharingPreferences;
  set<K extends keyof SharingPreferences>(
    key: K,
    value: SharingPreferences[K],
  ): SharingPreferences;
}
