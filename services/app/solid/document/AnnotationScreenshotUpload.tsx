/* @jsxImportSource solid-js */
/**
 * The composer's "Upload screenshot" fallback, split out so AnnotationLayer (statically imported by the reader page)
 * does not carry ui/Field for a control that shows only when a screenshot is required and could not be captured.
 */
import type { JSX } from 'solid-js';
import { Input } from '../ui/Field';

export function ScreenshotUpload(props: { onFile: (file: File) => void }): JSX.Element {
  return <label class="block space-y-2 font-medium">Upload screenshot<Input size="sm" type="file" accept="image/png,image/jpeg,image/webp" aria-label="Upload screenshot"
    onChange={(event) => { const file = event.currentTarget.files?.[0]; if (file) props.onFile(file); event.currentTarget.value = ''; }} /></label>;
}
