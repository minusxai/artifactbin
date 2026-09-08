import {createRoot} from 'react-dom/client';
import '@fontsource-variable/cormorant-garamond';
import '@fontsource-variable/jetbrains-mono';
import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@/app/globals.css';
import {PageFrameRouter} from './page-frame';
import {RegionPage} from './RegionPage';
import {SessionProvider} from './session';
import {configureAppApi} from './api-origin';
import {installControlsShell} from './controls-shell';
import type {PublicPath,TrustedRegionKind} from './public-page-contract';

const config=JSON.parse(document.getElementById('mx-page-frame-config')!.textContent!) as {apiOrigin:string;path:PublicPath;region:TrustedRegionKind;search:string};
configureAppApi(location.origin+config.path+config.search+location.hash,config.apiOrigin,'page');
installControlsShell(config.apiOrigin);
createRoot(document.getElementById('root')!).render(<PageFrameRouter path={config.path} search={config.search} main={config.apiOrigin}><SessionProvider><RegionPage kind={config.region} page={config.path} main={config.apiOrigin}/></SessionProvider></PageFrameRouter>);
