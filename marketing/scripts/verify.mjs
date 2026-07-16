import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const manifest = JSON.parse(await readFile(join(root, "manifest.json"), "utf8"));
const failures = [];
const fail = (message) => failures.push(message);
const sha256 = (buffer) => createHash("sha256").update(buffer).digest("hex");

if (manifest.edition !== "public") fail("Manifest edition is not public.");
if (manifest.publisher !== "MAYOWA-007") fail("Unexpected publisher.");
if (manifest.outputCount !== 41 || manifest.outputs.length !== 41) fail("Expected exactly 41 public outputs.");

const seen = new Set();
let byteTotal = 0;

for (const output of manifest.outputs) {
  if (output.edition !== "public") fail(`${output.id}: non-public edition.`);
  if (seen.has(output.file)) fail(`${output.file}: duplicate manifest entry.`);
  seen.add(output.file);

  const assetPath = resolve(root, output.file);
  const assetRelative = relative(resolve(root, "assets"), assetPath);
  if (assetRelative.startsWith("..") || isAbsolute(assetRelative)) {
    fail(`${output.file}: escapes the marketing asset directory.`);
    continue;
  }

  try {
    const buffer = await readFile(assetPath);
    const fileStat = await stat(assetPath);
    byteTotal += fileStat.size;
    if (fileStat.size !== output.bytes) fail(`${output.file}: byte count differs from manifest.`);
    if (sha256(buffer) !== output.sha256) fail(`${output.file}: SHA-256 differs from manifest.`);
    const normalizedBinaryText = buffer
      .toString("latin1")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");
    if (normalizedBinaryText.includes("knightaiav")) {
      fail(`${output.file}: contains a non-public company label in binary content or metadata.`);
    }

    if (output.format === "PNG") {
      const signature = buffer.subarray(0, 8).toString("hex");
      const width = buffer.readUInt32BE(16);
      const height = buffer.readUInt32BE(20);
      if (signature !== "89504e470d0a1a0a") fail(`${output.file}: invalid PNG signature.`);
      if (width !== output.width || height !== output.height) fail(`${output.file}: expected ${output.width}x${output.height}, found ${width}x${height}.`);
    } else if (output.format === "PDF") {
      if (!buffer.subarray(0, 5).equals(Buffer.from("%PDF-"))) fail(`${output.file}: invalid PDF signature.`);
      if (output.pages !== 1 || output.media !== "US Letter") fail(`${output.file}: expected one US Letter page.`);
    } else {
      fail(`${output.file}: unsupported format ${output.format}.`);
    }
  } catch (error) {
    fail(`${output.file}: ${error.message}`);
  }
}

if (byteTotal !== manifest.totalBytes) fail("Aggregate byte count differs from manifest.");

const assetFiles = (await readdir(join(root, "assets"), { withFileTypes: true }))
  .filter((entry) => entry.isFile())
  .map((entry) => `assets/${entry.name}`);
for (const file of assetFiles) if (!seen.has(file)) fail(`${file}: unmanifested asset.`);
for (const file of seen) if (!assetFiles.includes(file)) fail(`${file}: missing asset.`);

const textFiles = ["README.md", "index.html", "gallery.css", "gallery.js", "manifest.json", "scripts/export-public.mjs"];
const restricted = [
  /knightaiav/i,
  /knight ai\s*\+\s*av/i,
  /\.worktrees/i,
  /c:\\users\\/i,
  /github\.com\/knight-/i,
  /ghp_[a-z0-9]+/i,
  /sk-[a-z0-9_-]{16,}/i,
  /openai_api_key/i,
];
for (const file of textFiles) {
  const text = await readFile(join(root, file), "utf8");
  for (const pattern of restricted) if (pattern.test(text)) fail(`${file}: restricted public text matched ${pattern}.`);
}

if (failures.length) {
  console.error(`Marketing verification failed with ${failures.length} issue(s):`);
  failures.forEach((message) => console.error(`- ${message}`));
  process.exitCode = 1;
} else {
  console.log(`Marketing verification passed: ${manifest.outputs.length} public assets, exact hashes, dimensions, file set, and isolation.`);
}
