// Copies the MediaPipe Tasks Vision wasm runtime into public/ so the app serves
// it from its own origin (works offline once cached, no CDN version drift).
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'node_modules', '@mediapipe', 'tasks-vision', 'wasm');
const dest = join(root, 'public', 'mediapipe', 'wasm');
if (!existsSync(src)) {
  console.warn('[copy-mediapipe] tasks-vision not installed yet, skipping');
  process.exit(0);
}
mkdirSync(dest, { recursive: true });
cpSync(src, dest, { recursive: true });
console.log('[copy-mediapipe] copied wasm runtime to public/mediapipe/wasm');
