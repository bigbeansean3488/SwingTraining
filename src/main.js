// Entry point. Keep this file thin: wire UI modules to app state.
// Analysis logic lives in src/analysis and must not import from src/ui.

export const APP_VERSION = '0.0.1';

function checkEnvironment() {
  const checks = {
    'ES modules': true,
    IndexedDB: 'indexedDB' in window,
    WebAssembly: typeof WebAssembly === 'object',
    WebGL2: !!document.createElement('canvas').getContext('webgl2'),
  };
  return Object.entries(checks)
    .map(([name, ok]) => `${ok ? '✓' : '✗'} ${name}`)
    .join('  ');
}

document.getElementById('app-version').textContent = `v${APP_VERSION}`;
document.getElementById('env-status').textContent = checkEnvironment();
