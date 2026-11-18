import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  base: './',
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'ยิงเป้าแก๊งเพื่อน',
        short_name: 'ยิงเป้า',
        start_url: './',
        scope: './',
        display: 'fullscreen',
        orientation: 'landscape',
        background_color: '#2a1458',
        theme_color: '#2a1458',
        icons: [{ src: 'favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,woff2}'],
        globIgnores: ['wasm/**', 'models/**'],
        runtimeCaching: [
          {
            urlPattern: /\/(models|wasm)\//,
            handler: 'CacheFirst',
            options: { cacheName: 'ai-models', expiration: { maxEntries: 10 } },
          },
        ],
      },
    }),
  ],
  test: { environment: 'node' },
});
