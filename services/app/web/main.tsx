import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import '@fontsource-variable/cormorant-garamond';
import '@fontsource-variable/jetbrains-mono';
import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@/app/globals.css';
import { App } from './App';
import {configureAppApi} from './api-origin';
import {installControlsShell} from './controls-shell';

const controlsConfig = document.getElementById('mx-controls-config');
if (controlsConfig?.textContent) {
  const {apiOrigin} = JSON.parse(controlsConfig.textContent) as {apiOrigin:string};
  configureAppApi(window.location.origin,apiOrigin);
  installControlsShell(apiOrigin);
}

createRoot(document.getElementById('root')!).render(
  <BrowserRouter>
    <App />
  </BrowserRouter>,
);
