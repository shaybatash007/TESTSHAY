// Resizes the extracted product images into web-ready variants.
//
// The archives ship raw camera files: 1205 images totalling 2.0 GB, many of
// them 10+ MB. A catalogue cannot ship that. Each source image becomes:
//
//   thumb  400px  - grid cards
//   card   900px  - product hero
//   full  1600px  - lightbox
//
// plus a blurred LQIP for instant paint. Sources are kept unless --purge is
// passed, so the derived set can always be rebuilt from the originals.

import { readdir, mkdir, stat, writeFile, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";

const ROOT = path.resolve(import.meta.dirname, "..");
const SRC = path.join(ROOT, "assets", "source");
const OUT = path.join(ROOT, "assets", "products");

const VARIANTS = [
  { name: "thumb", width: 400 },
  { name: "card", width: 900 },
  { name: "full", width: 1600 },
];

const LQIP_WIDTH = 24;
const PURGE = process.argv.includes("--purge");

const Image = /* @__PURE__ */ new Map();

async function build() {
  if (!existsSync(SRC)) {
    console.error(`No source directory at ${SRC}`);
    process.exit(1);
  }
  await mkdir(OUT, { recursive: true });

  const files = (await readdir(SRC)).filter((f) =>
    /\.(jpe?g|png|webp|gif|bmp)$/i.test(f)
  );
  console.log(`Optimising ${files.length} images...`);

  const index = {};
  let done = 0;
  let srcBytes = 0;
  let outBytes = 0;

  for (const file of files) {
    const srcPath = path.join(SRC, file);
    const stem = path.parse(file).name;

    try {
      const meta = await sharp(srcPath, { failOn: "none" }).metadata();
      srcBytes += (await stat(srcPath)).size;

      const record = {
        w: meta.width ?? 0,
        h: meta.height ?? 0,
        thumb: "",
        card: "",
        full: "",
        lqip: "",
      };

      // Blurred placeholder, encoded inline so no extra request is needed.
      const tiny = await sharp(srcPath, { failOn: "none" })
        .resize({ width: LQIP_WIDTH })
        .blur(1.2)
        .webp({ quality: 32 })
        .toBuffer();
      record.lqip = `data:image/webp;base64,${tiny.toString("base64")}`;

      for (const v of VARIANTS) {
        // Never upscale: a 600px source keeps its own width.
        const width = Math.min(v.width, meta.width ?? v.width);
        const name = `${stem}--${v.name}.webp`;
        const outPath = path.join(OUT, name);

        await sharp(srcPath, { failOn: "none" })
          .rotate() // honour EXIF orientation before stripping metadata
          .resize({ width, withoutEnlargement: true })
          .webp({ quality: 82, effort: 4 })
          .toFile(outPath);

        record[v.name] = `assets/products/${name}`;
        outBytes += (await stat(outPath)).size;
      }

      // A tall or wide original is a detail shot, not a product shot. Prefer
      // a roughly square/landscape image as the card so grids stay even.
      index[stem] = record;
      done++;
      if (done % 100 === 0) console.log(`  ${done}/${files.length}`);
    } catch (err) {
      console.error(`  SKIP ${file}: ${err.message}`);
    }
  }

  await writeFile(
    path.join(ROOT, "data", "images.json"),
    JSON.stringify({ generated: new Date().toISOString(), images: index }, null, 0)
  );

  console.log(`Done. ${done}/${files.length} images`);
  console.log(`  source : ${(srcBytes / 1048576).toFixed(1)} MB`);
  console.log(`  output : ${(outBytes / 1048576).toFixed(1)} MB`);
  console.log(`  saved  : ${(100 - (outBytes / srcBytes) * 100).toFixed(1)}%`);

  if (PURGE) {
    for (const file of files) await unlink(path.join(SRC, file));
    console.log("Source purged (--purge).");
  }
}

build().catch((err) => {
  console.error(err);
  process.exit(1);
});
