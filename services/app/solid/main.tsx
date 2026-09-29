/* @jsxImportSource solid-js */
/** The Solid application entry for the Trash HTML page. */
// FIRST: the address bar holds the canonical path before anything below reads it (web/heal-address).
import '../web/heal-address';
import { render } from 'solid-js/web';
import { App } from './App';

render(() => <App />, document.getElementById('root')!);
