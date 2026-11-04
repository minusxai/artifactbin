/**
 * SAVE BEFORE COMMENTING in an editable region. A region's live text between versions is not in the saved source, and
 * the server anchors a comment to a saved version (anchor revision == version, quote found in its source). So a comment
 * whose anchor is inside a region first saves every unsaved region edit as a page version (`POST …/regions/flush`,
 * lib/artifact-backend/region-http) and anchors to the version that save returns. The server is unchanged.
 *
 * Inside: the region element itself, any node it holds in the saved page, or a node the saved page does not hold
 * yet (a block typed since the last save is identified only when it is saved). A save with nothing unsaved is a
 * no-op that returns the current version, so the cautious reading costs one request.
 */
import type { HtmlNodeAnchor } from '@artifactbin/contracts';

/** What the comment composer sends: an html-node anchor, or a bare node id. */
export interface RegionCommentSubject { anchor?: HtmlNodeAnchor; nodeId?: string }

/** The saved page's identities: those inside an editable region (regions included) and every one it holds. */
export interface RegionMembership { inside: ReadonlySet<string>; known: ReadonlySet<string> }

/** Every saved node a comment names: its node, its ancestor and each segment's node. */
export function anchorIds(subject: RegionCommentSubject): string[] {
  const ids: string[] = [];
  const add = (id: string | null | undefined) => { if (id && !ids.includes(id)) ids.push(id); };
  add(subject.anchor?.nodeId);
  add(subject.anchor?.ancestorId);
  for (const segment of subject.anchor?.segments ?? []) add(segment.nodeId);
  add(subject.nodeId);
  return ids;
}

export function commentNeedsRegionSave(subject: RegionCommentSubject, membership: RegionMembership): boolean {
  return anchorIds(subject).some((id) => membership.inside.has(id) || !membership.known.has(id));
}

/**
 * The subject to send: unchanged outside regions; inside one, after `save` resolved, anchored to the saved version.
 * A failed save rejects, and the composer keeps the draft.
 */
export async function commentAfterRegionSave<T extends RegionCommentSubject>(subject: T, ports: { membership(): RegionMembership; save(): Promise<number> }): Promise<T> {
  if (!commentNeedsRegionSave(subject, ports.membership())) return subject;
  const version = await ports.save();
  return subject.anchor ? { ...subject, anchor: { ...subject.anchor, revision: String(version) } } : subject;
}
