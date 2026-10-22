import { defineConfig } from 'vite';
export default defineConfig({
  base: './',
  server: {proxy: {'/api': {target: 'http://127.0.0.1:8788', changeOrigin: true}}},
  build: {outDir: 'dist', emptyOutDir: true}
});
