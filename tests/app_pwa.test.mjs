// node tests/app_pwa.test.mjs
// 新しい画面（app/）を PWA にするための物のテスト。仕様：docs/app-screens.md §15
//  - app/manifest.webmanifest：JSON として読める・要る項目がある・URL がすべて相対（公開先 /Seikakushindan/app/ でも手元 /app/ でも動くように）
//  - アイコン：ファイルがあり、PNG の幅と高さが sizes の表記どおり。192 と 512、maskable がある。index.html の apple-touch-icon も
//  - app/js/pwa.js の installState：状態の分け方（standalone・追加し終わった・ボタン・LINE などアプリの中・iPhone・それ以外）
//  - app/sw.js：版の番号・殻の一覧が相対・殻のファイルが実在する（文法は node --check app/sw.js で別に確かめる）
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { installState, currentInstallState, PWA_EVENT } from "../app/js/pwa.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const APP = join(ROOT, "app");

let fail = 0, pass = 0;
function test(name, fn) {
  try { fn(); pass++; console.log("OK   " + name); }
  catch (e) { fail++; console.log("FAIL " + name + "\n  " + (e.stack || e).toString().split("\n").slice(0, 6).join("\n  ")); }
}

/** PNG の頭（IHDR）から幅と高さを読む */
function pngSize(path) {
  const b = readFileSync(path);
  assert.equal(b.subarray(0, 8).toString("hex"), "89504e470d0a1a0a", `PNG ではありません：${path}`);
  assert.equal(b.subarray(12, 16).toString("ascii"), "IHDR");
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
}
const isRelative = (u) => typeof u === "string" && u.length > 0 && !/^[a-z][a-z0-9+.-]*:/i.test(u) && !u.startsWith("/");

// ---------------------------------------------------------------- マニフェスト
const manifest = JSON.parse(readFileSync(join(APP, "manifest.webmanifest"), "utf8"));

test("マニフェストに要る項目がある", () => {
  for (const k of ["name", "short_name", "start_url", "scope", "display", "icons"]) assert.ok(manifest[k], `${k} がありません`);
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.lang, "ja");
  assert.match(manifest.theme_color, /^#[0-9A-Fa-f]{6}$/);
  assert.match(manifest.background_color, /^#[0-9A-Fa-f]{6}$/);
});

test("theme_color は index.html の theme-color と同じ", () => {
  const html = readFileSync(join(APP, "index.html"), "utf8");
  const m = html.match(/<meta name="theme-color" content="(#[0-9A-Fa-f]{6})">/);
  assert.ok(m, "index.html に theme-color がありません");
  assert.equal(manifest.theme_color.toUpperCase(), m[1].toUpperCase());
});

test("URL はすべて相対（start_url・scope・アイコン・ショートカット）", () => {
  for (const k of ["start_url", "scope"]) assert.ok(isRelative(manifest[k]), `${k}：${manifest[k]}`);
  const urls = [
    ...manifest.icons.map((i) => i.src),
    ...(manifest.shortcuts || []).flatMap((s) => [s.url, ...(s.icons || []).map((i) => i.src)]),
  ];
  for (const u of urls) assert.ok(isRelative(u), u);
});

test("アイコン：192 と 512 があり、maskable もある", () => {
  const has = (size, purpose) => manifest.icons.some((i) => i.sizes === `${size}x${size}` && (i.purpose || "any").split(/\s+/).includes(purpose));
  assert.ok(has(192, "any"), "192 any");
  assert.ok(has(512, "any"), "512 any");
  assert.ok(has(192, "maskable") || has(512, "maskable"), "maskable");
  assert.ok(has(512, "maskable"), "512 maskable");
});

test("アイコン：ファイルが実在し、PNG の幅と高さが表記どおり（ショートカットも）", () => {
  const all = [...manifest.icons, ...(manifest.shortcuts || []).flatMap((s) => s.icons || [])];
  assert.ok(all.length >= 4);
  for (const icon of all) {
    const path = join(APP, icon.src);
    assert.ok(existsSync(path), `ありません：app/${icon.src}`);
    assert.equal(icon.type, "image/png");
    const [w, h] = icon.sizes.split("x").map(Number);
    assert.deepEqual(pngSize(path), { width: w, height: h }, icon.src);
  }
});

test("id は書かない（Chrome は id をオリジンの根から読むので、\"./\" だと kento20020.github.io 全体になる。無ければ start_url が id）", () => {
  assert.equal(Object.hasOwn(manifest, "id"), false);
});

test("ショートカット：相談・診断・診断結果（app/ の中のハッシュ）", () => {
  const urls = (manifest.shortcuts || []).map((s) => s.url);
  assert.deepEqual(urls, ["./#consult", "./#diagnose", "./#result"]);
  for (const s of manifest.shortcuts) assert.ok(s.name);
});

test("index.html：マニフェストと apple-touch-icon（180）を読む", () => {
  const html = readFileSync(join(APP, "index.html"), "utf8");
  assert.match(html, /<link rel="manifest" href="\.\/manifest\.webmanifest">/);
  const m = html.match(/<link rel="apple-touch-icon" href="([^"]+)">/);
  assert.ok(m && isRelative(m[1]), "apple-touch-icon");
  assert.deepEqual(pngSize(join(APP, m[1])), { width: 180, height: 180 });
});

test("元の SVG がある（差し替えるときの元。tools/make_pwa_icons.mjs）", () => {
  for (const f of ["icon.svg", "icon-maskable.svg"]) {
    const svg = readFileSync(join(APP, "img/pwa", f), "utf8");
    assert.match(svg, /viewBox="0 0 512 512"/, f);
  }
});

// ---------------------------------------------------------------- service worker
test("sw.js：版の番号があり、殻の一覧は相対で、ファイルが実在する", () => {
  const src = readFileSync(join(APP, "sw.js"), "utf8");
  assert.match(src, /const VERSION = "v\d+";/);
  const list = src.match(/const SHELL = \[([\s\S]*?)\];/);
  assert.ok(list, "SHELL がありません");
  const paths = [...list[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  assert.ok(paths.includes("./") && paths.includes("./index.html") && paths.includes("./js/main.js"));
  for (const p of paths) {
    assert.ok(isRelative(p), p);
    const file = p === "./" ? "index.html" : p.replace(/^\.\//, "");
    assert.ok(existsSync(join(APP, file)), `ありません：app/${file}`);
  }
});

// ---------------------------------------------------------------- installState
const UA = {
  androidChrome: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36",
  androidLine: "Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/AP2A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/140.0.0.0 Mobile Safari/537.36 Line/14.16.0/IAB",
  iphoneLine: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Safari Line/14.16.0",
  instagram: "Mozilla/5.0 (Linux; Android 14; Pixel 8; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/140.0.0.0 Mobile Safari/537.36 Instagram 350.0.0.0",
  iphoneSafari: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1",
  iphoneChrome: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/140.0.0.0 Mobile/15E148 Safari/604.1",
  ipadSafari: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15",
  pcChrome: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
};

test("installState：ホーム画面のアプリとして開いていれば installed（ほかより先）", () => {
  assert.equal(installState({ standalone: true, ua: UA.androidChrome }), "installed");
  assert.equal(installState({ standalone: true, hasPrompt: true, ua: UA.androidLine }), "installed");
  assert.equal(installState({ standalone: true, ua: UA.iphoneSafari }), "installed");
});

test("installState：追加し終わった（ブラウザのタブのまま）は added", () => {
  assert.equal(installState({ added: true, ua: UA.androidChrome }), "added");
});

test("installState：ボタンで追加できるときは prompt", () => {
  assert.equal(installState({ hasPrompt: true, ua: UA.androidChrome }), "prompt");
  assert.equal(installState({ hasPrompt: true, ua: UA.pcChrome }), "prompt");
});

test("installState：LINE などアプリの中のブラウザは line", () => {
  assert.equal(installState({ ua: UA.androidLine }), "line");
  assert.equal(installState({ ua: UA.iphoneLine }), "line");
  assert.equal(installState({ ua: UA.instagram }), "line");
});

test("installState：iPhone・iPad は ios（iPad の Safari は Mac の UA ＋指で触れる）", () => {
  assert.equal(installState({ ua: UA.iphoneSafari }), "ios");
  assert.equal(installState({ ua: UA.iphoneChrome }), "ios");
  assert.equal(installState({ ua: UA.ipadSafari, touch: 5 }), "ios");
  assert.equal(installState({ ua: UA.ipadSafari, touch: 0 }), "menu");   // Mac の Safari
});

test("installState：それ以外は menu（Android の Chrome でボタンがまだ来ていない・PC）", () => {
  assert.equal(installState({ ua: UA.androidChrome }), "menu");
  assert.equal(installState({ ua: UA.pcChrome }), "menu");
  assert.equal(installState(), "menu");
  assert.equal(installState({ ua: "Mozilla/5.0 (Linux; Android 14) Timeline/1.0" }), "menu");   // 「Line/」を含む別の語では line にしない
});

test("Node（window が無い）でも読み込めて、currentInstallState は落ちない", () => {
  assert.equal(PWA_EVENT, "a-pwa-change");
  assert.equal(currentInstallState(), "menu");
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
