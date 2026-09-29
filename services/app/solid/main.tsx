/* @jsxImportSource solid-js */
/** The Solid application entry for the Trash HTML page. */
import { render } from 'solid-js/web';
import '@/web/heal-address';
import { captureInitialStory } from '@/web/initial-story';
import { App } from './App';

captureInitialStory();
render(() => <App />, document.getElementById('root')!);
