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
import {PageFrameRouter} from './page-frame';

const controlsConfig = document.getElementById('mx-controls-config');
const pageFrameConfig=document.getElementById('mx-page-frame-config');
const pageFrame=pageFrameConfig?.textContent?JSON.parse(pageFrameConfig.textContent) as {apiOrigin:string;path:string;folderOnly?:boolean}:null;
const appConfig = controlsConfig ?? pageFrameConfig ?? document.getElementById('mx-app-config');
if (appConfig?.textContent) {
  const {apiOrigin} = JSON.parse(appConfig.textContent) as {apiOrigin:string};
  configureAppApi(window.location.origin+(pageFrame?pageFrame.path+window.location.search+window.location.hash:''),apiOrigin,controlsConfig?'controls':pageFrame?.folderOnly?'folder':pageFrame?'page':'standalone');
  if (controlsConfig) installControlsShell(apiOrigin);
}

createRoot(document.getElementById('root')!).render(
  pageFrame ? <PageFrameRouter path={pageFrame.path} main={pageFrame.apiOrigin}><App/></PageFrameRouter> : <BrowserRouter>
    <App />
  </BrowserRouter>,
);
