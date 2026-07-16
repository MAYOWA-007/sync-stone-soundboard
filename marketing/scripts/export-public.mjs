import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, readdir, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const marketingRoot = resolve(here, "..");
const assetRoot = join(marketingRoot, "assets");
const sourceRoot = process.argv[2] ? resolve(process.argv[2]) : null;

if (!sourceRoot) {
  throw new Error("Usage: node marketing/scripts/export-public.mjs <campaign-master-directory>");
}

const sha256 = (buffer) => createHash("sha256").update(buffer).digest("hex");
const readJson = async (file) => JSON.parse(await readFile(file, "utf8"));

await mkdir(assetRoot, { recursive: true });

const campaignManifest = await readJson(join(sourceRoot, "output", "manifest.json"));
const documentManifest = await readJson(join(sourceRoot, "output", "one-pager", "manifest.json"));
const campaignOutputs = campaignManifest.outputs.filter(({ edition }) => edition === "public");
const documentOutputs = documentManifest.outputs.filter(({ edition }) => edition === "public");

if (campaignOutputs.length !== 39 || documentOutputs.length !== 2) {
  throw new Error(`Expected 39 campaign images and 2 document outputs; found ${campaignOutputs.length} and ${documentOutputs.length}.`);
}

const published = [];

for (const item of campaignOutputs) {
  const sourceFile = join(sourceRoot, "output", item.file);
  const targetFile = join(assetRoot, item.file);
  await copyFile(sourceFile, targetFile);
  const buffer = await readFile(targetFile);
  const fileStat = await stat(targetFile);

  published.push({
    id: item.id,
    conceptId: item.conceptId,
    family: item.family,
    layout: item.layout,
    edition: "public",
    format: "PNG",
    width: item.width,
    height: item.height,
    file: `assets/${item.file}`,
    bytes: fileStat.size,
    sha256: sha256(buffer),
    alt: item.alt,
  });
}

for (const item of documentOutputs) {
  const name = item.file.split("/").at(-1);
  const sourceFile = join(sourceRoot, "output", "one-pager", name);
  const targetFile = join(assetRoot, name);
  await copyFile(sourceFile, targetFile);
  const buffer = await readFile(targetFile);
  const fileStat = await stat(targetFile);
  const format = name.endsWith(".pdf") ? "PDF" : "PNG";

  published.push({
    id: item.id,
    conceptId: "one-pager-document",
    family: "one-pager",
    layout: format === "PDF" ? "print-document" : "vertical-proof",
    edition: "public",
    format,
    ...(item.width ? { width: item.width, height: item.height } : {}),
    ...(item.media ? { media: item.media, pages: item.pages } : {}),
    file: `assets/${name}`,
    bytes: fileStat.size,
    sha256: sha256(buffer),
    alt: format === "PDF" ? "Sync Stone public one-page product sheet in US Letter PDF format." : "Sync Stone public product sheet rendered at 2160 by 3840 pixels.",
  });
}

const expectedNames = new Set(published.map(({ file }) => file.split("/").at(-1)));
for (const entry of await readdir(assetRoot, { withFileTypes: true })) {
  if (entry.isFile() && !expectedNames.has(entry.name)) {
    await unlink(join(assetRoot, entry.name));
  }
}

const manifest = {
  schemaVersion: 1,
  campaign: "sync-stone-public-launch",
  edition: "public",
  publisher: "MAYOWA-007",
  exportedAt: new Date().toISOString(),
  app: "https://mayowa-007.github.io/sync-stone-soundboard/",
  repository: "https://github.com/MAYOWA-007/sync-stone-soundboard",
  truthBoundary: "Controller and Player pair in the same browser profile on one device. Uploaded audio remains local in browser storage.",
  formatBoundary: "The file chooser recognizes 254 researched audio extension aliases. Playback still requires the active browser to decode the selected file; no universal transcoding is claimed.",
  outputCount: published.length,
  totalBytes: published.reduce((sum, item) => sum + item.bytes, 0),
  outputs: published,
};

await writeFile(join(marketingRoot, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(`Exported ${published.length} public campaign assets (${manifest.totalBytes.toLocaleString()} bytes).`);
