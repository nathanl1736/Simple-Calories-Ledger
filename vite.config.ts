import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: '/Simple-Calories-Ledger/',
  plugins: [react()],
  build: {
    outDir: 'dist',
    sourcemap: true
  }
});
