import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],

      manifest: {
        name: 'FloodCast Gurugram',
        short_name: 'FloodCast',
        description:
          'Will my route through Gurugram flood in the next few hours, and when exactly?',
        theme_color: '#0E1417',
        background_color: '#0E1417',
        display: 'standalone',
        orientation: 'portrait',
        scope: '/',
        start_url: '/',
        categories: ['weather', 'navigation', 'utilities'],
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: '/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },

      workbox: {
        // The register is compiled into the bundle, so precaching the build
        // output is enough to open the app, draw the map and list all 73
        // points with no network at all.
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],

        runtimeCaching: [
          {
            // Map tiles are the only large thing fetched at runtime, and a
            // cached tile is still a correct tile: roads do not move. This
            // is what makes the map usable offline.
            urlPattern: /^https:\/\/[abc]\.tile\.openstreetmap\.org\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'osm-tiles',
              expiration: { maxEntries: 500, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],

        // Open-Meteo is deliberately NOT cached here.
        //
        // The app already caches the forecast itself, and crucially it
        // labels what it is showing: "reusing the forecast fetched in the
        // last 30 minutes", or "could not reach Open-Meteo, showing the
        // forecast from 40 minutes ago". A service worker cache would sit
        // underneath that and hand back a stale response as though it were
        // fresh, so the app would state a rainfall figure it believes is
        // current when it is hours old. On a flood tool that is the exact
        // failure this project exists to avoid, so the request is left to
        // fail honestly and the app's own fallback handles it.
        navigateFallback: '/index.html',
      },

      devOptions: {
        // Off in dev: a service worker caching a dev build is a reliable way
        // to spend an afternoon debugging a stale bundle.
        enabled: false,
      },
    }),
  ],

  build: {
    // Leaflet is the one heavy dependency and it never changes between
    // deploys; splitting it out keeps app updates off the critical path
    // for returning users.
    rollupOptions: {
      output: {
        manualChunks: (id: string) =>
          /node_modules[\\/](leaflet|react-leaflet|@react-leaflet)/.test(id)
            ? 'leaflet'
            : undefined,
      },
    },
  },
});
