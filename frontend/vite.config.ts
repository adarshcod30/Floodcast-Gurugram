import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
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
