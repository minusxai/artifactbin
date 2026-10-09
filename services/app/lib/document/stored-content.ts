/**
 * What the publish door hands back for one content body (lib/story/document/input): the row's format,
 * its markup source, its `meta` and a derived title. Type-only, so the content stores and the dataset
 * tiers (lib/datasets, lib/object-store) can name it without importing the publish pipeline.
 */
import type { ArtifactFormat } from '@artifactbin/contracts';
import type { SourceRepair } from '@/lib/jsx/repair';

export interface StoredContent {
  format: ArtifactFormat;
  source: string | null; // markup source for round-trip editing
  meta: Record<string, unknown>;
  /** Title derived from the source's first heading — used only when the body has no title. */
  derivedTitle: string | null;
  /**
   * Changes the door made to the source on the way in (lib/jsx/repair) — today
   * only the shell-escaped backtick. Present ONLY when something was changed,
   * and present is the point: the door is allowed to repair an agent's markup
   * exactly because it names what it did, rather than rewriting SQL in silence.
   */
  repairs?: SourceRepair[];
}
