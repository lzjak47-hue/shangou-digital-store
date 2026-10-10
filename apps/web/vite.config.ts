import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  plugins: [react(), {
    name: 'admin-entry-rewrite',
    configureServer(server) {
      server.middlewares.use((request, _response, next) => {
        const pathname = request.url?.split('?')[0] || '';
        if (pathname === '/admin' || pathname.startsWith('/admin/')) {
          const queryIndex = request.url?.indexOf('?') ?? -1;
          request.url = `/admin.html${queryIndex >= 0 ? request.url!.slice(queryIndex) : ''}`;
        }
        next();
      });
    },
  }],
  server: { host: '127.0.0.1', port: 8001, strictPort: true },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        store: resolve(import.meta.dirname, 'index.html'),
        admin: resolve(import.meta.dirname, 'admin.html'),
      },
    },
  },
});
