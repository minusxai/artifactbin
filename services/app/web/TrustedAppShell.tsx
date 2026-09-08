import {useEffect, useState, type ReactNode} from 'react';
import {TrustedUiHost} from '@/components/TrustedUi';
// Vite's CSS pipeline compiles Tailwind before returning this owned string.
import compiledStyles from '@/app/globals.css?inline';
import {scopeTrustedStyles} from './trusted-styles';

const styles = scopeTrustedStyles(compiledStyles);
export function TrustedAppShell({children}: {children: ReactNode}) {
  const [mode, setMode] = useState<'light'|'dark'>(() => {
    try { return localStorage.getItem('mx_theme') === 'dark' ? 'dark' : 'light'; } catch { return 'light'; }
  });
  useEffect(() => {
    const update = (event: Event) => setMode((event as CustomEvent).detail === 'dark' ? 'dark' : 'light');
    window.addEventListener('mx:app:appearance', update);
    return () => window.removeEventListener('mx:app:appearance', update);
  }, []);
  return <TrustedUiHost styles={styles} mode={mode}>{children}</TrustedUiHost>;
}
