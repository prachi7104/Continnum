// Serves the React client and proxies local API traffic to Hono.
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';

try { loadEnvFile(); } catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
}

export default defineConfig({
  root: fileURLToPath(new URL('./client', import.meta.url)),
  plugins: [react()],
  server: {
    host: '127.0.0.1', port: 5173, strictPort: true,
    proxy: { '/api': 'http://127.0.0.1:' + (process.env.PORT || '8787') },
  },
});
