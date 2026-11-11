/**
 * BLOCKED MODAL DIALOGS — where a page is shown inside the app's frame or the `/raw` sandbox, the browser shows no
 * `alert()`, `confirm()` or `prompt()`: neither sandbox grants `allow-modals`, on purpose, since a page's code could
 * otherwise stack blocking dialogs over the app around it. The call answers what the browser answers there
 * (`undefined`, `false`, `null`) and, until now, said nothing a page author would see.
 *
 * Installed by core before any author script runs: the first call of each dialog warns once on the console, naming
 * the `af-dialog` component, and then calls the browser's own (which keeps its answer and its own message). At a
 * page's own unframed address the browser shows them, so nothing is wrapped. Framework-free: part of every core.
 */
const DIALOGS = { alert: 'undefined', confirm: 'false', prompt: 'null' } as const;

export function noticeBlockedModals(win: Window, warn: (message: string) => void = (message) => console.warn(message)): void {
  let blocked: boolean;
  try { blocked = win.parent !== win || win.origin === 'null'; } catch { blocked = true; }
  if (!blocked) return;
  const host = win as unknown as Record<keyof typeof DIALOGS, (...args: unknown[]) => unknown>;
  for (const name of Object.keys(DIALOGS) as Array<keyof typeof DIALOGS>) {
    const native = host[name];
    if (typeof native !== 'function') continue;
    let told = false;
    host[name] = function (...args: unknown[]) {
      if (!told) {
        told = true;
        warn(`[artifactbin] ${name}() is blocked where this page is shown (a sandboxed frame shows no modal dialogs) and returns ${DIALOGS[name]}: use the af-dialog component (import '@afbin/dialog') instead.`);
      }
      return Reflect.apply(native, win, args);
    };
  }
}
