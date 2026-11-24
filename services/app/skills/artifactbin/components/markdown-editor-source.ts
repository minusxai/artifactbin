/**
 * Internal: the Visual / Markdown control and plain source input. Used by markdown-editor.ts.
 * The host owns one accepted field value for both views. A view switch never emits a change.
 */
export function sourceMode(host: HTMLElement, frame: HTMLElement, toolbar: HTMLElement,
  surface: HTMLElement, fieldId: string, read: () => string, change: (source: string) => void,
  select: () => void) {
  const doc = host.ownerDocument;
  const modes = doc.createElement('div');
  modes.className = 'af-md-modes';
  modes.setAttribute('role', 'group');
  modes.setAttribute('aria-label', 'Editing mode');
  const field = doc.createElement('textarea');
  field.className = 'af-md-source';
  field.id = fieldId + '-source';
  field.hidden = true;
  field.spellcheck = false;
  field.setAttribute('aria-labelledby', fieldId + '-label');
  surface.id = fieldId + '-visual';
  const buttons = ['visual', 'markdown'].map((mode, i) => {
    const button = doc.createElement('button');
    button.type = 'button'; button.dataset.mode = mode;
    button.textContent = i ? 'Markdown' : 'Visual';
    button.setAttribute('aria-controls', i ? field.id : surface.id);
    button.setAttribute('aria-pressed', String(!i));
    button.addEventListener('click', () => {
      const source = mode === 'markdown';
      if (field.hidden !== source) return;
      field.hidden = !source; surface.hidden = source;
      frame.toggleAttribute('data-source', source);
      buttons.forEach(b => b.setAttribute('aria-pressed', String(b === button)));
      select();
      if (source) field.focus(); else surface.querySelector<HTMLElement>('.ProseMirror')?.focus();
    });
    return button;
  });
  field.addEventListener('input', () => {
    if (!field.readOnly && !field.disabled) change(field.value);
  });
  modes.append(...buttons); toolbar.append(modes); frame.append(field);
  return {
    field,
    sync(name: string | null, rows: number) {
      if (!field.hidden && field.value !== read()) field.value = read();
      field.readOnly = host.hasAttribute('readonly');
      field.disabled = host.hasAttribute('disabled');
      field.rows = rows; field.placeholder = host.getAttribute('placeholder') ?? '';
      if (name) field.setAttribute('aria-label', name); else field.removeAttribute('aria-label');
      for (const button of buttons) button.disabled = field.disabled;
    },
  };
}
