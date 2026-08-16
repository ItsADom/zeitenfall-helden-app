import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, '../shared/src'),
    },
  },
  server: {
    // 5173 bleibt der Normalfall; PORT erlaubt eine zweite Instanz daneben,
    // ohne dass sich beide um den Port streiten.
    port: Number(process.env.PORT) || 5173,
    proxy: {
      '/api': 'http://localhost:3001',
    },
  },
});
