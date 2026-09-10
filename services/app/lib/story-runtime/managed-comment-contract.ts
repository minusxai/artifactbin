import type { AnnotationAreaRange, AnnotationTextRange, AnnotationRect } from '@/lib/story/annotation-range';
import type { IframeNodeTarget } from '@/lib/story/comment-target';

export type ManagedCommentRefinement = AnnotationAreaRange | AnnotationTextRange;
export interface ManagedCommentSelection {
  target: IframeNodeTarget;
  rect: AnnotationRect;
  quote?: string;
  range?: ManagedCommentRefinement;
}
export interface ManagedCommentState {
  type: 'comment-state';
  generation: string;
  enabled: boolean;
  picking: boolean;
  canComment: boolean;
  pins: Array<{ id: string; target: IframeNodeTarget; range?: ManagedCommentRefinement | null }>;
  openId: string | null;
  hoverId: string | null;
  selection: ManagedCommentSelection | null;
}
export type ManagedCommentEvent =
  | { type: 'comment-selection'; generation: string; selection: ManagedCommentSelection | null }
  | { type: 'comment-hover'; generation: string; id: string | null }
  | { type: 'comment-pin'; generation: string; id: string; rect: AnnotationRect }
  | { type: 'comment-layout'; generation: string; positions: Array<{ id: string; rect: AnnotationRect; status: 'exact' | 'missing' | 'ambiguous' }> }
  | { type: 'comment-select-mode'; generation: string };
