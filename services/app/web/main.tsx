import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router';
import '@fontsource-variable/cormorant-garamond';
import '@fontsource-variable/jetbrains-mono';
import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@/app/globals.css';
import trustedCss from '@/app/globals.css?inline';
import { configureTrustedUiStyles } from '@/components/TrustedUi';
import { App } from './App';
import { NavigationBoundary } from './NavigationBoundary';

configureTrustedUiStyles(trustedCss);
const router = createBrowserRouter([{ path: '*', element: <NavigationBoundary><App /></NavigationBoundary> }]);

createRoot(document.getElementById('root')!).render(
  <RouterProvider router={router} />,
);
