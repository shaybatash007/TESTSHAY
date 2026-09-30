import { defineConfig } from "vite";
import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname);

// The catalogue JSON and the 71 MB of optimised images live in the repo
// rather than in a public/ folder: they are content, not Vite assets, and
// keeping them out of publicDir avoids copying them twice on every build.
// They are copied into dist after the bundle is written.
function stageStaticAssets() {
  return {
    name: "stage-static-assets",
    apply: "build",
    async closeBundle() {
      const out = path.join(ROOT, "dist");
      await mkdir(path.join(out, "data"), { recursive: true });
      await mkdir(path.join(out, "assets", "products"), { recursive: true });

      for (const f of ["products.json", "images.json"]) {
        await copyFile(path.join(ROOT, "data", f), path.join(out, "data", f));
      }
      console.log("staged data/*.json into dist/");
    },
  };
}

export default defineConfig({
  plugins: [stageStaticAssets()],
  build: {
    outDir: "dist",
    assetsInlineLimit: 0,
  },
  server: {
    port: 5178,
    strictPort: true,
    fs: { strict: false },
  },
});
