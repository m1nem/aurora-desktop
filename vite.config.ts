import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

const rootDir = import.meta.dirname;

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(rootDir, './src'),
      'next/link': path.resolve(rootDir, './src/lib/next-link.tsx'),
      'next/navigation': path.resolve(rootDir, './src/lib/next-navigation.ts'),
    },
  },
});
