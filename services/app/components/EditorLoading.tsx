import { APP_BAR_H, EDIT_BAR_H } from '@/lib/story/edit-bar';

/** Fixed editor-toolbar placeholder: loading the editor must not enter document flow. */
export default function EditorLoading() {
  return <p role="status" className="fixed inset-x-0 z-50 m-0 flex items-center justify-center border-b border-edge bg-surface font-mono text-xs text-faint" style={{top:APP_BAR_H,height:EDIT_BAR_H}}>loading the editor…</p>;
}
