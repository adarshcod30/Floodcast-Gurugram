import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';

import App from './App';
import './index.css';

/**
 * Install the service worker.
 *
 * This is what makes the app installable and what lets it open with no
 * network: the bundle, and therefore the whole 73-point register, is
 * precached. It matters most in exactly the conditions this tool is for,
 * when a storm has the local network congested.
 *
 * Updates apply on the next visit rather than mid-session. Reloading the
 * page under someone reading a flood verdict would be a poor trade for
 * shipping a scoring change a few minutes sooner.
 */
registerSW({ immediate: true });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
