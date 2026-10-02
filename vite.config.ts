import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': path.resolve(import.meta.dirname, 'src') } },
  // O MapLibre carrega um web worker próprio; o pré-bundle do Vite quebra o caminho dele.
  optimizeDeps: { exclude: ['maplibre-gl'] },
  // Worker do MapLibre importa módulos ES compartilhados (ver src/lib/map/maplibre.tsx).
  worker: { format: 'es' },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
    include: ['src/**/*.test.{ts,tsx}', 'scripts/**/*.test.ts'],
  },
});
