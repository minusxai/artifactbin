/** Shared inert/live frame geometry prevents hydration layout shifts. */
export function managedFrameLayout(title:unknown,height:unknown,fallback='Interactive artifact') {
  return {
    label:typeof title==='string'&&title.trim()?title.slice(0,200):fallback,
    pixels:typeof height==='number'&&Number.isFinite(height)?Math.max(100,Math.min(4096,height)):320,
  };
}
