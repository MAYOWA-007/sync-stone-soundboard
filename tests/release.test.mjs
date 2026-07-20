import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";

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
  assert.match(worker, /const SHELL_VERSION = "0\.2\.0"/);
  assert.match(worker, /sync-stone\.shell-version\.request/);
  assert.match(worker, /clients\.matchAll\(\{ type: "window", includeUncontrolled: true \}\)/);
});

test("service worker reports its version and notifies every open app window on activation", async () => {
  const handlers = new Map();
  const posted = [];
  let claimed = false;
  const self = {
    registration: { scope: "https://example.test/sync-stone-soundboard/" },
    location: { origin: "https://example.test" },
    clients: {
      claim: async () => { claimed = true; },
      matchAll: async () => [{ postMessage: (message) => posted.push(message) }],
    },
    addEventListener: (type, handler) => handlers.set(type, handler),
    skipWaiting: async () => {},
  };
  runInNewContext(read("sw.js"), {
    self,
    caches: { keys: async () => [], delete: async () => true },
    fetch: async () => { throw new Error("not used"); },
    URL,
  });

  const replies = [];
  handlers.get("message")({
    data: { type: "sync-stone.shell-version.request" },
    source: { postMessage: (message) => replies.push(message) },
  });
  assert.equal(replies[0].type, "sync-stone.shell-version");
  assert.equal(replies[0].version, "0.2.0");

  let activation;
  handlers.get("activate")({ waitUntil: (promise) => { activation = promise; } });
  await activation;
  assert.equal(claimed, true);
  assert.equal(posted[0].type, "sync-stone.shell-active");
  assert.equal(posted[0].version, "0.2.0");
});

test("release fails closed across split app versions and keeps an accessible update action", () => {
  const html = read("index.html");
  const app = read("js/app.js");
  assert.match(html, /data-check="version"/);
  assert.match(html, /data-player-check="version"/);
  assert.match(html, /id="app-update" role="status"/);
  assert.match(html, /id="app-update-action"/);
  assert.match(app, /VERSION_MISMATCH/);
  assert.match(app, /sync-stone:update-required/);
});

test("runtime preserves the no-egress contract", () => {
  const html = read("index.html");
  assert.match(html, /connect-src 'self'/);
  for (const file of ["index.html", "js/app.js", "js/core.js", "js/storage.js", "js/audio-engine.js", "sw.js"]) {
    assert.doesNotMatch(read(file), /https?:\/\//i, `${file} contains an external runtime URL`);
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
