import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import '@fontsource-variable/cormorant-garamond';
import '@fontsource-variable/jetbrains-mono';
import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@/app/globals.css';
import { App } from './App';
import {configureAppApi} from './api-origin';

const appConfig = document.getElementById('mx-app-config');
if (appConfig?.textContent) {
  const {apiOrigin} = JSON.parse(appConfig.textContent) as {apiOrigin:string};
  configureAppApi(window.location.href,apiOrigin,'standalone');
}

createRoot(document.getElementById('root')!).render(
  <BrowserRouter>
    <App />
  </BrowserRouter>,
);
