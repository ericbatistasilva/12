import { defineConfig } from 'vite';

// GitHub Pages publica este repositório em /12/.
// Fora do GitHub Actions, mantém a raiz / para desenvolvimento local.
export default defineConfig({
  base: process.env.GITHUB_ACTIONS ? '/12/' : '/',
  build: {
    outDir: 'dist',
    sourcemap: false,
    target: 'es2022'
  },
  server: {
    port: 5173,
    open: false
  }
});
