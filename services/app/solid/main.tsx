/* @jsxImportSource solid-js */
/** The Solid application entry for the Trash HTML page. */
// FIRST: the address bar holds the canonical path before anything below reads it (web/heal-address).
import '../web/heal-address';
import { captureInstallPrompt } from '@/lib/pwa-install';
import { render } from 'solid-js/web';
import '@/web/heal-address';
import { captureInitialStory } from '@/web/initial-story';
import { configureTrustedUiFromShell } from '@/lib/trusted-ui-styles';
import { App } from './App';

captureInstallPrompt(window);
captureInitialStory();
// The app's own sheet, re-scoped into every trusted shadow root (solid/components/TrustedUi).
configureTrustedUiFromShell(document);
render(() => <App />, document.getElementById('root')!);
