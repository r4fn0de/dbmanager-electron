import path from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
  build: {
    rollupOptions: {
      external: [
        "embedded-postgres",
        /^@embedded-postgres\//,
        "pg",
        "pg-native",
        "better-sqlite3",
        "bindings",
        "@xenova/transformers",
        "onnxruntime-node",
        "onnxruntime-web",
        "sharp",
      ],
    },
  },
});
