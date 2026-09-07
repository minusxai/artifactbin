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
const appConfig = controlsConfig ?? document.getElementById('mx-app-config');
if (appConfig?.textContent) {
  const {apiOrigin} = JSON.parse(appConfig.textContent) as {apiOrigin:string};
  configureAppApi(window.location.origin,apiOrigin,!!controlsConfig);
  if (controlsConfig) installControlsShell(apiOrigin);
}

createRoot(document.getElementById('root')!).render(
  <BrowserRouter>
    <App />
  </BrowserRouter>,
);
