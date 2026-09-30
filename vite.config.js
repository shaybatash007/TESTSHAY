import { defineConfig } from "vite";
import { cp, mkdir, stat } from "node:fs/promises";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname);

// The optimised image variants (71 MB, 3,600 files) and the catalogue JSON are
// content rather than Vite assets. Copying 3,600 files individually is slow, so
// the whole directories are moved into dist after the bundle is written.
function stageContent() {
  return {
    name: "stage-content",
    apply: "build",
    async closeBundle() {
      const out = path.join(ROOT, "dist");

      await cp(path.join(ROOT, "data"), path.join(out, "data"), { recursive: true });

      const src = path.join(ROOT, "assets", "products");
      const dst = path.join(out, "assets", "products");
      await mkdir(dst, { recursive: true });
      await cp(src, dst, { recursive: true });

      let bytes = 0;
      let count = 0;
      for (const f of await (await import("node:fs/promises")).readdir(dst)) {
        bytes += (await stat(path.join(dst, f))).size;
        count++;
      }
      console.log(
        `staged content: ${count} images (${(bytes / 1048576).toFixed(1)} MB) + data/*.json`
      );
    },
  };
}

export default defineConfig({
  plugins: [stageContent()],
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
