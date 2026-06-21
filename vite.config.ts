import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  publicDir: "public",
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: false,
    rollupOptions: {
      input: {
        options: resolve(__dirname, "options.html"),
        background: resolve(__dirname, "src/background/index.ts"),
        content: resolve(__dirname, "src/content.ts"),
        injected: resolve(__dirname, "src/injected.ts")
      },
      output: {
        entryFileNames: "[name].js",
        chunkFileNames: "chunks/[name]-[hash].js",
        assetFileNames: "assets/[name][extname]"
      }
    }
  }
});
