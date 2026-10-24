import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: 'src',
  base: './',
  plugins: [
    svelte(),
    tailwindcss(),
  ],
  build: {
    outDir: path.resolve(__dirname, 'extension'),
    emptyOutDir: false,
    rollupOptions: {
      input: {
        panel: path.resolve(__dirname, 'src/panel.html'),
      },
      output: {
        entryFileNames: 'panel.js',
        chunkFileNames: 'assets/[name].js',
        assetFileNames: (assetInfo) => {
          if (assetInfo.name && assetInfo.name.endsWith('.css')) return 'panel.css';
          return 'assets/[name].[ext]';
        },
      },
    },
  },
});
