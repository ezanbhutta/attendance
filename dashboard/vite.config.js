import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // Relative base so the build also loads from file:// inside the Electron desktop app.
  base: './',
  plugins: [react()],
  server: { port: 5173 },
});
