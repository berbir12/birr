import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './index.css';
import { initTelegram } from './telegram';

initTelegram();

// Telegram passes launch data in the hash ("#tgWebAppData=…", or appended to "#/review").
// The SDK has read it by now; keep only our route so the hash router sees a clean path.
const route = /^#(\/[^?&#]*)/.exec(location.hash)?.[1] ?? '/';
if (location.hash !== `#${route}`) history.replaceState(history.state, '', `${location.pathname}${location.search}#${route}`);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
