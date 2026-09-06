import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

// https://vitejs.dev/config/
export default defineConfig({
  base: './', // Crucial for Electron relative file:// asset resolution
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
    watch: {
      ignored: ['**/release/**', '**/build_dist/**', '**/dist-installer/**'],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src')
    }
  },
  optimizeDeps: {
    // Vite's dev-server dependency pre-bundler (esbuild) externalizes Node
    // builtins like `util` for anything it pre-optimizes, replacing them
    // with a minimal browser stub whose TextEncoder isn't a real
    // constructor. face-api.js's bundled TensorFlow.js code hits that path,
    // throwing "this.util.TextEncoder is not a constructor" the moment
    // anything imports it (dev mode only - the production Rollup build
    // never went through this optimizer, which is why release builds never
    // showed this). Excluding it from pre-bundling skips that broken
    // shimming step entirely; Vite still serves it as an ES module on
    // request.
    exclude: ['face-api.js'],
  },
});
