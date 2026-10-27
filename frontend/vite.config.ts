import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Mesma origem em dev e produção: o cookie de sessão é httpOnly e o SSE não precisa de CORS.
    proxy: { '/api': { target: 'http://127.0.0.1:3101', changeOrigin: false } },
  },
});
