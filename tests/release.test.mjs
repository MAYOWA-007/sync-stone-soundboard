import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path, encoding = "utf8") => readFileSync(resolve(root, path), encoding);

test("web app manifest carries installable local-scope identity and raster icons", () => {
  const manifest = JSON.parse(read("manifest.webmanifest"));
  assert.equal(manifest.id, "./");
  assert.equal(manifest.start_url, "./");
  assert.equal(manifest.scope, "./");

  const expected = new Map([[192, "./assets/icons/sync-stone-192.png"], [512, "./assets/icons/sync-stone-512.png"]]);
  for (const [size, source] of expected) {
    const icon = manifest.icons.find((candidate) => candidate.src === source);
    assert.ok(icon, `missing ${size}px manifest icon`);
    assert.match(icon.purpose, /any/);
    const png = read(source.slice(2), null);
    assert.equal(png.toString("ascii", 1, 4), "PNG");
    assert.equal(png.readUInt32BE(16), size);
    assert.equal(png.readUInt32BE(20), size);
  }
});

test("service-worker shell contains only files that exist", () => {
  const worker = read("sw.js");
  const shell = worker.match(/const SHELL = \[([\s\S]*?)\];/)?.[1];
  assert.ok(shell, "service-worker shell list missing");
  const paths = [...shell.matchAll(/"(.+?)"/g)].map((match) => match[1]);
  assert.ok(paths.includes("./manifest.webmanifest"));
  assert.ok(paths.includes("./assets/icons/sync-stone-512.png"));
  for (const path of paths.filter((candidate) => candidate !== "./")) {
    assert.ok(statSync(resolve(root, path.slice(2))).size > 0, `missing shell asset: ${path}`);
  }
});

test("public release exposes Trigger View with an explicit browser-only boundary", () => {
  const html = read("index.html");
  const core = read("js/core.js");
  const app = read("js/app.js");
  const storage = read("js/storage.js");
  const worker = read("sw.js");
  assert.match(html, /id="trigger-view-toggle"/);
  assert.match(html, /id="trigger-fullscreen"/);
  assert.match(html, /data-edition="public"/);
  assert.match(html, /250\+ researched aliases selectable/);
  assert.match(html, /This edition does not convert files/i);
  assert.doesNotMatch(html, /Production target|cross-device WebSockets/i);
  assert.match(core, /sync-stone-soundboard-public:v1/);
  assert.match(app, /APP_NAMESPACE}:room:/);
  assert.match(storage, /sync-stone-soundboard-public-audio-v1/);
  assert.match(worker, /sync-stone-soundboard-public-shell-/);
  assert.match(worker, /SCOPE_PATH/);
});

test("public shipping files contain no private brand, infrastructure, font, or local path", () => {
  const files = ["index.html", "styles.css", "package.json", "sw.js", "README.md", "docs/browser-feasibility.html", "docs/import-compatibility.md"];
  const combined = files.map((path) => read(path)).join("\n");
  assert.doesNotMatch(combined, /Knight|KnightAIAV|AWS|AppSync|Aurora|Cognito|DynamoDB|CloudFront|C:\\Users|\.vercel/i);
  assert.doesNotMatch(combined, /assets\/fonts/i);
});
