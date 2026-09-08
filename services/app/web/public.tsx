import {hydrateRoot} from 'react-dom/client';
import {BrowserRouter} from 'react-router';
import '@fontsource-variable/cormorant-garamond';
import '@fontsource-variable/jetbrains-mono';
import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@/app/globals.css';
import {PublicPage} from './PublicPage';
import type {PublicPageData} from './public-page-contract';

const data=JSON.parse(document.getElementById('mx-public-page')!.textContent!) as PublicPageData;
hydrateRoot(document.getElementById('root')!,<BrowserRouter><PublicPage data={data}/></BrowserRouter>);
