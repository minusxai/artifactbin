import {createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode} from 'react';
import {createPortal} from 'react-dom';

/** First-party CSS isolation, never an author-script or authentication boundary.
 * Callers supply first-party styles only. The root owns its portal target and
 * must dispose it on unmount; no sensitive element is placed in light DOM. */
export interface TrustedUiProps {
  children: ReactNode;
  /** Already shadow-scoped first-party CSS, never document.styleSheets.
   * Scope root tokens to [data-trusted-ui-root] / [data-mx-theme-host]; global
   * :root and body selectors do not match elements inside a ShadowRoot. */
  styles: string;
  mode: 'light' | 'dark';
}

const PortalContainer = createContext<HTMLElement | null>(null);
/** One persistent boundary; children stay in light DOM. */
export function TrustedUiHost(props: TrustedUiProps): ReactNode { return <BoundaryHost {...props} shared />; }
/** Portals at the source React position; null while its shared host mounts.
 * Outside a host it preserves existing standalone component behavior. */
export function TrustedChrome({children}: {children:ReactNode}): ReactNode {
  const boundary = useContext(SharedBoundary);
  if (boundary === undefined) return children;
  return boundary && createPortal(<PortalContainer.Provider value={boundary.portals}>{children}</PortalContainer.Provider>, boundary.content);
}
interface Boundary {root: ShadowRoot; style: HTMLStyleElement; scope: HTMLDivElement; content: HTMLDivElement; portals: HTMLDivElement}
const SharedBoundary = createContext<Boundary | null | undefined>(undefined);

/** `all` deliberately excludes custom properties, direction and unicode-bidi.
 * Reset variables read/declared by trusted CSS plus currently inherited ones.
 * An early layer lets caller-owned theme/utility layers define their values. */
function resetCss(host: HTMLElement, styles: string): string {
  const names = new Set(styles.match(/--[a-zA-Z_][\w-]*/g) ?? []);
  for (let element: Element | null = host; element; element = element.parentElement) {
    const computed = getComputedStyle(element);
    for (let i = 0; i < computed.length; i++) {
      const name = computed.item(i);
      if (/^--[a-zA-Z_][\w-]*$/.test(name)) names.add(name);
    }
  }
  return '@layer trusted-ui-reset { :host { all:initial!important; display:contents!important; direction:ltr!important; unicode-bidi:normal!important; } [data-trusted-ui-root] { all:initial; display:block; direction:ltr; unicode-bidi:normal; text-align:start; color:CanvasText; font:14px ui-sans-serif,system-ui,sans-serif; color-scheme:light; ' + [...names].map(name => name + ':initial;').join('') + ' } }\n';
}

export function TrustedUi({children, styles, mode}: TrustedUiProps): ReactNode {
  return <BoundaryHost styles={styles} mode={mode}>{children}</BoundaryHost>;
}

function BoundaryHost({children, styles, mode, shared = false}: TrustedUiProps & {shared?: boolean}): ReactNode {
  const host = useRef<HTMLDivElement>(null);
  const owned = useRef<Boundary | null>(null);
  const [boundary, setBoundary] = useState<Boundary | null>(null);
  useLayoutEffect(() => {
    if (!owned.current) {
      const root = host.current!.attachShadow({mode:'closed'});
      const style = document.createElement('style');
      style.textContent = resetCss(host.current!,styles) + styles;
      const scope = document.createElement('div');
      scope.setAttribute('data-trusted-ui-root','');
      scope.setAttribute('data-mx-theme-host','');
      scope.dataset.appAppearance = mode;
      scope.dataset.theme = mode;
      scope.style.colorScheme = mode;
      const content = document.createElement('div');
      const portals = document.createElement('div');
      scope.append(content,portals);
      root.append(style,scope);
      owned.current = {root,style,scope,content,portals};
    }
    setBoundary(owned.current);
  }, []);
  useLayoutEffect(() => {
    if (!boundary) return;
    boundary.style.textContent = resetCss(host.current!,styles) + styles;
    boundary.scope.dataset.appAppearance = mode;
    boundary.scope.dataset.theme = mode;
    boundary.scope.style.colorScheme = mode;
  }, [boundary, styles, mode]);
  useEffect(() => () => {
    // Passive cleanup follows React's portal disposal. StrictMode's simulated
    // cleanup leaves the host connected and must not destroy the live root.
    if (owned.current && !owned.current.root.host.isConnected) owned.current.root.replaceChildren();
  }, []);
  if (shared) return <SharedBoundary.Provider value={boundary}><div ref={host} />{children}</SharedBoundary.Provider>;
  return <div ref={host}>{boundary && createPortal(<PortalContainer.Provider value={boundary.portals}>{children}</PortalContainer.Provider>,boundary.content)}</div>;
}

/** Null outside trusted chrome: ordinary app dialogs retain normal behavior. */
export function useTrustedPortalContainer(): HTMLElement | null {
  return useContext(PortalContainer);
}
