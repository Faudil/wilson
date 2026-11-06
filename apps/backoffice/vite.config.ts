import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// Workspace packages (@wilson/contracts, @wilson/i18n) export their TS sources directly, Vite compiles them.
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    proxy: { "/rpc": { target: "http://localhost:3000", changeOrigin: true } },
  },
  preview: { port: 4173, proxy: { "/rpc": { target: "http://localhost:3000", changeOrigin: true } } },
  build: { target: "es2022", sourcemap: false },
  test: { environment: "node", include: ["test/**/*.test.ts"] },
});
