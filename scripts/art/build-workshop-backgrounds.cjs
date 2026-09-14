// Keep the original JPEGs; regenerate only these delivery variants.
const sharp = require("sharp");
const path = require("node:path");
const root = path.resolve(
  __dirname,
  "../../services/app/public/landing/workshop",
);
(async () => {
  for (const scene of ["indoor", "outdoor"]) {
    for (const width of [960, 1672, 2560, 3344]) {
      const output = path.join(root, `${scene}-${width}.webp`);
      await sharp(path.join(root, `${scene}.jpg`))
        .resize({ width, withoutEnlargement: true })
        .webp({ quality: 88, effort: 6 })
        .toFile(output);
      console.log(path.basename(output));
    }
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
