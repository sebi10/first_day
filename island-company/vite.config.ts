import { resolve } from 'node:path';

const __dirname = import.meta.dirname;
import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        lab: resolve(__dirname, 'lab.html'),
      },
    },
  },
  server: { port: 5173, strictPort: true },
  // one pre-bundle for preact + hooks so there is never a second copy of preact
  optimizeDeps: { include: ['preact', 'preact/hooks', 'preact/jsx-runtime', 'preact/jsx-dev-runtime'] },
});
