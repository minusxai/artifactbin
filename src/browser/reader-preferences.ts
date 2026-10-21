import type { SharingPreferences } from "../contracts.ts";
import type {
  ReaderPreferences,
  ReaderPreferenceStorage,
} from "./reader-preferences-contracts.ts";
const key = "pagegi-reader-preferences";
const defaults: SharingPreferences = {
  visible: true,
  shareCursor: true,
  shareView: true,
  showCursors: true,
  shareSelection: true,
  showSelections: true,
};
function decode(raw: string | null): SharingPreferences {
  let value: unknown = null;
  try {
    value = JSON.parse(raw || "null");
  } catch {}
  const result = { ...defaults };
  if (value && typeof value === "object" && !Array.isArray(value)) {
    for (const name of Object.keys(defaults) as (keyof SharingPreferences)[]) {
      const choice = (value as Record<string, unknown>)[name];
      if (typeof choice === "boolean") result[name] = choice;
    }
  }
  return result;
}
/**
 * Origin-local reader choices never enter the page's JSON store or source.
 * This tab's choices are what it read when it opened plus what it has set
 * since: another tab's later choices are never adopted into it, but a set
 * writes only its own key over what is stored, so other tabs' choices stay
 * saved. A choice that could not be saved is written with the next save, unless
 * another tab saved in between: then it is dropped rather than replayed over
 * the newer stored value.
 */
export function createReaderPreferences(
  storage: () => ReaderPreferenceStorage | null,
): ReaderPreferences {
  /** The stored text this tab last read or wrote; another tab saving changes it (each write is distinct). */
  let seen: string | null | undefined;
  let unsaved: Partial<SharingPreferences> = {};
  function open(): { target: ReaderPreferenceStorage; raw: string | null } | null {
    try {
      const target = storage();
      return target ? { target, raw: target.getItem(key) } : null;
    } catch {
      return null;
    }
  }
  const initial = open();
  seen = initial?.raw;
  let current = initial ? decode(initial.raw) : { ...defaults };
  let writes = 0;
  return {
    read: () => ({ ...current }),
    set(name, value) {
      current = { ...current, [name]: value };
      const disk = open();
      if (disk && disk.raw !== seen) unsaved = {};
      unsaved[name] = value;
      if (disk) {
        const written = JSON.stringify({
          ...decode(disk.raw),
          ...unsaved,
          // Distinguishes this write from any other tab's, even with the same choices.
          write: `${Date.now().toString(36)}.${Math.random().toString(36).slice(2)}.${++writes}`,
        });
        try {
          disk.target.setItem(key, written);
          seen = written;
          unsaved = {};
        } catch {
          /* Keep the choice for this session and the next save when storage is full. */
          seen = disk.raw;
        }
      }
      return { ...current };
    },
  };
}
