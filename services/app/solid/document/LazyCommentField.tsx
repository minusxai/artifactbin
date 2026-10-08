/* @jsxImportSource solid-js */
import { lazy, Suspense, type JSX } from 'solid-js';
import type { CommentMarkdownFieldProps } from './CommentMarkdownField';

/**
 * The comment composer without its ProseMirror weight: the editor chunk loads when a
 * composer first renders, under its own Suspense boundary so the page around it stays up.
 * Reading comments never needs it (CommentMarkdown renders them).
 */
const Field = lazy(() => import('./CommentMarkdownField').then((module) => ({ default: module.CommentMarkdownField })));

/** Fetch the composer chunk ahead of its first render (tests, and any caller that knows a composer is coming). */
export const preloadCommentField = (): Promise<unknown> => Field.preload();

export function CommentMarkdownField(props: CommentMarkdownFieldProps): JSX.Element {
  return <Suspense fallback={<div aria-hidden="true" class="min-h-24" />}><Field {...props} /></Suspense>;
}
