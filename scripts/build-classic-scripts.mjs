import { build } from "esbuild";
import { readFile } from "node:fs/promises";
import path from "node:path";

const rawTextPlugin = {
  name: "raw-text",
  setup(buildContext) {
    buildContext.onResolve({ filter: /\?raw$/ }, (args) => {
      return {
        path: path.resolve(args.resolveDir, args.path.replace(/\?raw$/, "")),
        namespace: "raw-text"
      };
    });
    buildContext.onLoad({ filter: /.*/, namespace: "raw-text" }, async (args) => {
      return {
        contents: await readFile(args.path, "utf8"),
        loader: "text"
      };
    });
  }
};

const sharedOptions = {
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "chrome102",
  minify: true,
  sourcemap: false,
  logLevel: "info",
  plugins: [rawTextPlugin]
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
