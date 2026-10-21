import type { CommentInteraction } from "../contracts.ts";
import type { CommentSelection } from "./comment-panel-contracts.ts";
import { commentTransition } from "../chrome-model.ts";
import { jsonCopy } from "../json.ts";
/** Owns draft identity and immutable context independently of DOM repainting. */
export class CommentComposer {
  interaction: CommentInteraction = {
    active: null,
    pinned: false,
    expanded: false,
    drafts: {},
  };
  selection: CommentSelection | null = null;
  key(selection: CommentSelection, revision: string): string {
    return `new:${selection.nodeId}:${selection.snapshot?.sourceRevision || revision}`;
  }
  open(selection: CommentSelection): void {
    this.selection = jsonCopy(selection);
    this.interaction = commentTransition(this.interaction, { kind: "close" });
  }
  close(): void {
    this.selection = null;
    this.interaction = commentTransition(this.interaction, { kind: "close" });
  }
  rename(from: string, to: string): void {
    const { active, drafts } = this.interaction;
    const { [from]: draft, ...rest } = drafts;
    this.interaction = {
      ...this.interaction,
      active: active === from ? to : active,
      drafts: draft === undefined ? drafts : { ...rest, [to]: draft },
    };
  }
  sent(
    id: string,
    selection: CommentSelection,
    revision: string,
    parentId: string | null,
  ): void {
    const key = parentId || this.key(selection, revision);
    this.interaction = commentTransition(this.interaction, {
      kind: "sent",
      id: key,
    });
    this.selection = null;
    this.interaction = commentTransition(this.interaction, {
      kind: "open",
      id: parentId || id,
    });
  }
}
