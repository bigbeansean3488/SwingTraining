/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import pkg from './package.json' with { type: 'json' };

// `--mode solo` builds the stand-alone motion analysis app (docs/DECISIONS.md D27):
// same code, analysis pages only, no team features, no Supabase.
const EDITIONS = {
  team: {
    name: '棒球隊管理與訓練分析平台',
    shortName: '球隊訓練',
    description: '球隊管理、訓練紀錄、手機影片動作分析與比賽記錄',
  },
  solo: {
    name: '棒球動作分析',
    shortName: '動作分析',
    description: '用手機影片分析打擊與投球動作，影片只在手機上處理、不上傳',
  },
};

const SOLO_CSP =
  '<meta http-equiv="Content-Security-Policy" content="connect-src \'self\' https://storage.googleapis.com blob: data:" />';

export default defineConfig(({ mode }) => {
  const solo = mode === 'solo';
  const edition = solo ? EDITIONS.solo : EDITIONS.team;
  return {
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version),
      __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
      ...(solo
        ? {
            'import.meta.env.VITE_EDITION': JSON.stringify('solo'),
            // The solo app never talks to Supabase, even if the variables are set.
            'import.meta.env.VITE_SUPABASE_URL': 'undefined',
            'import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY': 'undefined',
            'import.meta.env.VITE_SUPABASE_ANON_KEY': 'undefined',
          }
        : {}),
    },
    plugins: [
      react(),
      {
        name: 'edition-title',
        transformIndexHtml: (html: string) => {
          html = html.replaceAll('球隊訓練', edition.shortName);
          // Solo app: the page may only connect to itself and Google's model bucket.
          // This blocks MediaPipe's usage-statistics upload (odml.pa.googleapis.com);
          // its logger stops after the first failed send. See docs/DECISIONS.md D28.
          const charset = '<meta charset="UTF-8" />';
          return solo ? html.replace(charset, `${charset}\n    ${SOLO_CSP}`) : html;
        },
      },
      VitePWA({
        registerType: 'autoUpdate',
        injectRegister: false,
        includeAssets: ['favicon.png', 'icons/apple-touch-icon.png'],
        manifest: {
          name: edition.name,
          short_name: edition.shortName,
          description: edition.description,
          lang: 'zh-Hant-TW',
          start_url: '/',
          scope: '/',
          display: 'standalone',
          orientation: 'portrait',
          theme_color: '#0b2545',
          background_color: '#ffffff',
          icons: [
            { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
            { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
            {
              src: 'icons/icon-maskable-512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable',
            },
          ],
        },
        workbox: {
          globPatterns: ['**/*.{js,css,html,png,svg,woff2,webmanifest}'],
          globIgnores: ['mediapipe/**'],
          navigateFallback: 'index.html',
          cleanupOutdatedCaches: true,
          maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
          runtimeCaching: [
            {
              // MediaPipe wasm runtime served from our own origin: cache on first use.
              urlPattern: ({ url, sameOrigin }) =>
                sameOrigin && url.pathname.startsWith('/mediapipe/'),
              handler: 'CacheFirst',
              options: {
                cacheName: 'mediapipe-wasm',
                expiration: { maxEntries: 10 },
              },
            },
            {
              // Pose models (.task) from Google's model bucket: cache on first use for offline analysis.
              urlPattern: ({ url }) =>
                url.hostname === 'storage.googleapis.com' &&
                url.pathname.includes('/mediapipe-models/'),
              handler: 'CacheFirst',
              options: {
                cacheName: 'mediapipe-models',
                expiration: { maxEntries: 4 },
                cacheableResponse: { statuses: [0, 200] },
              },
            },
          ],
        },
      }),
    ],
    build: {
      target: 'es2022',
      chunkSizeWarningLimit: 1500,
    },
    test: {
      environment: 'node',
      include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    },
  };
});
