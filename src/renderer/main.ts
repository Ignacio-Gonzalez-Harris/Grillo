// The renderer: the app shell, with every screen discovered under src/renderer/screens/.
// Every colour, spacing and size comes from the liquid glass token file (a copy of the UX prototype's), never from here.
import './theme/tokens.css';
import { createShell } from './app/shell';
import { loadScreens } from './app/screens';

const root = document.getElementById('app');
if (!root) {
  throw new Error('The renderer page has no #app element to mount the shell in');
}
createShell(root, { grillo: window.grillo, screens: loadScreens() });
