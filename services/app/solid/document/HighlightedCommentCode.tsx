/* @jsxImportSource solid-js */
import { renderCodeBlock } from '@/lib/markdown/code-block';
/** The shared renderer escapes all source and emits only fixed inert token spans. */
export default function HighlightedCommentCode(props: {text: string; language: string | null}) {
  return <div class="comment-code-highlight min-w-0" innerHTML={renderCodeBlock(props.text, props.language)}/>;
}
