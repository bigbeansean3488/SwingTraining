import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import './ui/styles.css';

registerSW({ immediate: true });

// The edition is a build-time constant, so only one app ends up in the bundle.
// eslint-disable-next-line react-refresh/only-export-components -- entry file, not a component module
const Root =
  import.meta.env.VITE_EDITION === 'solo'
    ? (await import('./SoloApp')).SoloApp
    : (await import('./App')).App;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
