/* @jsxImportSource solid-js */
/** The Solid application entry for the Trash HTML page. */
// FIRST: the address bar holds the canonical path before anything below reads it (solid/lib/heal-address).
import './lib/heal-address';
import { captureInstallPrompt } from '@/solid/lib/pwa-install';
import { render } from 'solid-js/web';
import '@/solid/lib/heal-address';
import { captureServedFrame } from '@/solid/lib/served-frame';
import { configureTrustedUiFromShell } from '@/lib/islands/trusted-ui-styles';
import { App } from './App';
import { watchAppBuild } from './lib/app-build';

captureInstallPrompt(window);
// Which build this page is, and every sign the server has moved on (a deploy while the tab is open).
watchAppBuild(window);
captureServedFrame();
// The app's own sheet, re-scoped into every trusted shadow root (solid/components/TrustedUi).
configureTrustedUiFromShell(document);
const root = document.getElementById('root')!;
// Static startup help is for readers without the app runtime.
root.replaceChildren();
render(() => <App />, root);
