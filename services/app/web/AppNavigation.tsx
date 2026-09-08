import {useLayoutEffect, type ReactNode} from 'react';
import {useNavigate} from 'react-router';
import {bindAppNavigation, tryAppNavigation} from './api-origin';

/** Lives once inside React Router. Only marked first-party DOM roots and the
 * closed trusted root's own listener are eligible for native-anchor routing. */
export function AppNavigationBinding(): ReactNode {
  const navigate = useNavigate();
  useLayoutEffect(() => bindAppNavigation((url, replace) => {
    void navigate(url.pathname + url.search + url.hash, {replace});
    return true;
  }), [navigate]);
  return null;
}
export function trustedAnchorNavigation(event: MouseEvent): void {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const anchor = event.target instanceof Element ? event.target.closest('a[href]') : null;
  if (!(anchor instanceof HTMLAnchorElement) || anchor.hasAttribute('download') || (anchor.target && anchor.target !== '_self') || anchor.rel.split(/\s+/).includes('external')) return;
  if (tryAppNavigation(new URL(anchor.href))) event.preventDefault();
}
/** Opt-in only: never wrap author document DOM with this component. */
export function TrustedAppLinks({children}:{children:ReactNode}): ReactNode {
  return <div style={{display:'contents'}} onClickCapture={event => trustedAnchorNavigation(event.nativeEvent)}>{children}</div>;
}
