/* @jsxImportSource solid-js */
/** The Solid application entry for the Trash HTML page. */
// FIRST: the address bar holds the canonical path before anything below reads it (solid/lib/heal-address).
import './lib/heal-address';
import { captureInstallPrompt } from '@/lib/serving/pwa-install';
import { render } from 'solid-js/web';
import '@/solid/lib/heal-address';
import { captureServedFrame } from '@/solid/lib/served-frame';
import { configureTrustedUiFromShell } from '@/lib/serving/trusted-ui-styles';
import { App } from './App';

captureInstallPrompt(window);
captureServedFrame();
// The app's own sheet, re-scoped into every trusted shadow root (solid/components/TrustedUi).
configureTrustedUiFromShell(document);
render(() => <App />, document.getElementById('root')!);
