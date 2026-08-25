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
    // 5180 bleibt der Normalfall (5173 ist auf dieser Maschine für einen
    // anderen Prozess reserviert); PORT erlaubt eine zweite Instanz daneben,
    // ohne dass sich beide um den Port streiten.
    port: Number(process.env.PORT) || 5180,
    proxy: {
      '/api': 'http://localhost:3001',
      '/ws': { target: 'ws://localhost:3001', ws: true },
    },
  },
});
