import { build } from "esbuild";

const sharedOptions = {
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "chrome102",
  minify: true,
  sourcemap: false,
  logLevel: "info"
};

await Promise.all([
  build({
    ...sharedOptions,
    entryPoints: ["src/content.ts"],
    outfile: "dist/content.js"
  }),
  build({
    ...sharedOptions,
    entryPoints: ["src/injected.ts"],
    outfile: "dist/injected.js"
  })
]);
