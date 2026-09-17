/** Shared reader share-sheet, clipboard and feedback lifecycle; scoped to one trusted chrome root. */
export function wireReaderSharing(win:Window,doc:Document,root:HTMLElement):{share():void;copied():void;dispose():void} {
  const TOAST_MS=1500;
  const toast = root.querySelector<HTMLElement>('[data-mx-reader-toast]');
  let toastTimer = 0;
  const say = () => {
    if (!toast || disposed) return;
    toast.hidden = false;
    win.clearTimeout(toastTimer);
    toastTimer = win.setTimeout(() => { toast.hidden = true; }, TOAST_MS);
  };
  let disposed=false;

  /*
   * The last resort, for a browser with neither a share sheet nor a clipboard
   * permission: a hidden readonly field the document selects and copies out of.
   * It is in the markup rather than created here because an element appended
   * during a click handler is not always focusable in time.
   */
  const copyField = root.querySelector<HTMLInputElement>('[data-mx-reader-copy]');
  const copyByExecCommand = (url: string): boolean => {
    if (!copyField || typeof doc.execCommand !== 'function') return false;
    copyField.value = url;
    copyField.select();
    try {
      return doc.execCommand('copy');
    } catch {
      return false;
    }
  };

  const shareTitle = () => {
    const titled = root.querySelector<HTMLElement>('.mx-reader-title');
    return (titled?.textContent ?? '').trim() || doc.title;
  };
  const share = () => {
    // The reader's document is served TOP-LEVEL, so its location is the real,
    // shareable address — not a frame's internal one.
    const url = win.location.href;
    const nav = win.navigator as Navigator & { share?: (data: ShareData) => Promise<void> };
    if (typeof nav.share === 'function') {
      // A dismissed sheet rejects; that is the reader saying no, not a failure.
      void nav.share({ title: shareTitle(), url }).catch(() => {});
      return;
    }
    const clipboard = nav.clipboard as Clipboard | undefined;
    if (clipboard && typeof clipboard.writeText === 'function') {
      void clipboard.writeText(url).then(say, () => { if (copyByExecCommand(url)) say(); });
      return;
    }
    if (copyByExecCommand(url)) say();
  };

  return {share,copied:say,dispose:()=>{disposed=true;win.clearTimeout(toastTimer);}};
}
