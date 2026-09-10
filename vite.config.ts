import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: './',
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 3050,
    strictPort: true,
    watch: {
      ignored: ['**/src-tauri/**', '**/*.bun-build', '**/dist/**', '**/.alisa-sessions/**', '**/.ichigo-sessions/**']
    },
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3001',
        changeOrigin: true,
      },
      '/ws': {
        target: 'ws://127.0.0.1:3001',
        ws: true,
      }
    }
  }
});
