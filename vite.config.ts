import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig({
  base: "./",
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        operator: resolve(__dirname, "operator.html"),
      },
    },
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
  },
});
