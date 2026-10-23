import { defineConfig } from 'vite';

// Chart.js y KaTeX hacen que el paquete supere el aviso por defecto de 500 kB.
export default defineConfig({
  build: { chunkSizeWarningLimit: 1000 },
});
