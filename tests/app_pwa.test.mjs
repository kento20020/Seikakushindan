// node tests/app_pwa.test.mjs
// 新しい画面（app/）を PWA にするための物のテスト。仕様：docs/app-screens.md §15
//  - app/manifest.webmanifest：JSON として読める・要る項目がある・URL がすべて相対（公開先 /Seikakushindan/app/ でも手元 /app/ でも動くように）
//  - アイコン：ファイルがあり、PNG の幅と高さが sizes の表記どおり。192 と 512、maskable がある。index.html の apple-touch-icon も
//  - app/js/pwa.js の installState：状態の分け方（standalone・追加し終わった・ボタン・LINE などアプリの中・iPhone の Safari・iPhone のほかのブラウザ・それ以外）と isIos
//  - app/sw.js：版の番号・殻の一覧が相対・殻のファイルが実在する（文法は node --check app/sw.js で別に確かめる）
//  - iPhone（§15.10。決定 U37）：index.html の meta（capable・上の帯）、起動画面（apple-touch-startup-image）の12本が縦向き・ファイルあり・
//    PNG の画素が device-width×倍率 × device-height×倍率・同じ端末の重なりなし
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { installState, currentInstallState, currentPlatform, isIos, PWA_EVENT } from "../app/js/pwa.js";

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
  const m = html.match(/<link rel="apple-touch-icon" sizes="180x180" href="([^"]+)">/);
  assert.ok(m && isRelative(m[1]), "apple-touch-icon（sizes=\"180x180\"）");
  assert.deepEqual(pngSize(join(APP, m[1])), { width: 180, height: 180 });
});

// ---------------------------------------------------------------- iPhone（§15.10）
const HTML = readFileSync(join(APP, "index.html"), "utf8");

test("index.html：iPhone の meta（capable を2つ・上の帯は default・名前）", () => {
  assert.match(HTML, /<meta name="mobile-web-app-capable" content="yes">/);
  assert.match(HTML, /<meta name="apple-mobile-web-app-capable" content="yes">/);
  const bar = HTML.match(/<meta name="apple-mobile-web-app-status-bar-style" content="([^"]+)">/);
  assert.ok(bar, "apple-mobile-web-app-status-bar-style がありません");
  assert.equal(bar[1], "default", "black-translucent は帯の文字が白になり、明るい地の上で読めない");
  assert.match(HTML, /<meta name="apple-mobile-web-app-title" content="16次元診断">/);
  assert.match(HTML, /<meta name="theme-color" content="#ECE6DE">/);
});

test("起動画面：12本、どれも iPhone の縦向き・ファイルあり・PNG の画素が端末どおり・重なりなし", () => {
  const links = [...HTML.matchAll(/<link rel="apple-touch-startup-image" href="([^"]+)" media="([^"]+)">/g)];
  assert.equal(links.length, 12);
  assert.equal((HTML.match(/apple-touch-startup-image/g) || []).length, 12, "形の違う行がまざっていない");
  const seen = new Set();
  for (const [, href, media] of links) {
    assert.ok(isRelative(href) && href.startsWith("./img/pwa/splash/"), href);
    const m = media.match(/^screen and \(device-width: (\d+)px\) and \(device-height: (\d+)px\) and \(-webkit-device-pixel-ratio: (\d)\) and \(orientation: portrait\)$/);
    assert.ok(m, `media の形：${media}`);
    const [w, h, r] = m.slice(1).map(Number);
    assert.ok(w < h, `縦向き（幅 < 高さ）：${media}`);
    assert.ok(w >= 375 && w <= 440, `iPhone の幅（iPad は作らない）：${w}`);
    const key = `${w}x${h}@${r}`;
    assert.ok(!seen.has(key), `同じ端末が2回：${key}`);
    seen.add(key);
    const file = join(APP, href);
    assert.ok(existsSync(file), `ありません：app/${href}`);
    assert.deepEqual(pngSize(file), { width: w * r, height: h * r }, href);
    assert.ok(href.endsWith(`splash-${w * r}x${h * r}.png`), `名前と画素が合う：${href}`);
    assert.ok(readFileSync(file).length <= 100 * 1024, `1枚 100KB 以下：${href}`);
  }
});

test("起動画面は service worker の殻に入れない（install で12枚を先に取りに行かない）", () => {
  const src = readFileSync(join(APP, "sw.js"), "utf8");
  assert.doesNotMatch(src.match(/const SHELL = \[([\s\S]*?)\];/)[1], /splash/);
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
  ipadChrome: "Mozilla/5.0 (iPad; CPU OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/140.0.0.0 Mobile/15E148 Safari/604.1",
  iphoneFirefox: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/140.0 Mobile/15E148 Safari/605.1.15",
  iphoneEdge: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 EdgiOS/140.0.0.0 Mobile/15E148 Safari/605.1.15",
  iphoneOpera: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 OPiOS/16.0.0 Mobile/15E148 Safari/9537.53",
  ipod: "Mozilla/5.0 (iPod touch; CPU iPhone OS 15_8 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.6 Mobile/15E148 Safari/604.1",
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

test("installState：iPhone・iPad の Safari は ios（iPad の Safari は Mac の UA ＋指で触れる）", () => {
  assert.equal(installState({ ua: UA.iphoneSafari }), "ios");
  assert.equal(installState({ ua: UA.ipadSafari, touch: 5 }), "ios");
  assert.equal(installState({ ua: UA.ipadSafari, touch: 0 }), "menu");   // Mac の Safari
});

test("installState：iPhone・iPad の Safari 以外のブラウザ（Chrome・Firefox・Edge・Opera）は ios-other", () => {
  assert.equal(installState({ ua: UA.iphoneChrome }), "ios-other");
  assert.equal(installState({ ua: UA.iphoneFirefox }), "ios-other");
  assert.equal(installState({ ua: UA.iphoneEdge }), "ios-other");
  assert.equal(installState({ ua: UA.iphoneOpera }), "ios-other");
  assert.equal(installState({ ua: UA.ipadChrome, touch: 5 }), "ios-other");
  assert.equal(installState({ ua: UA.ipadChrome }), "ios-other");   // iPad の UA なら touch が無くても
});

test("installState：iPhone でも LINE は line、standalone はどのブラウザでも installed", () => {
  assert.equal(installState({ ua: UA.iphoneLine }), "line");
  for (const ua of [UA.iphoneSafari, UA.iphoneChrome, UA.iphoneFirefox, UA.ipadChrome, UA.iphoneLine, UA.androidChrome, UA.pcChrome]) {
    assert.equal(installState({ standalone: true, ua, touch: 5 }), "installed", ua);
  }
  assert.equal(installState({ standalone: true, ua: UA.ipadSafari, touch: 5 }), "installed");
});

test("isIos：iPhone・iPad・iPod か、Mac の UA ＋指で触れる（iPad の Safari）", () => {
  for (const ua of [UA.iphoneSafari, UA.iphoneChrome, UA.iphoneFirefox, UA.iphoneLine, UA.ipadChrome, UA.ipod]) assert.equal(isIos({ ua }), true, ua);
  assert.equal(isIos({ ua: UA.ipadSafari, touch: 5 }), true);
  assert.equal(isIos({ ua: UA.ipadSafari, touch: 1 }), false);   // Mac（トラックパッドは 1 以下）
  assert.equal(isIos({ ua: UA.ipadSafari }), false);
  for (const ua of [UA.androidChrome, UA.androidLine, UA.instagram, UA.pcChrome]) assert.equal(isIos({ ua, touch: 5 }), false, ua);
  assert.equal(isIos(), false);
});

test("installState：それ以外は menu（Android の Chrome でボタンがまだ来ていない・PC）", () => {
  assert.equal(installState({ ua: UA.androidChrome }), "menu");
  assert.equal(installState({ ua: UA.pcChrome }), "menu");
  assert.equal(installState(), "menu");
  assert.equal(installState({ ua: "Mozilla/5.0 (Linux; Android 14) Timeline/1.0" }), "menu");   // 「Line/」を含む別の語では line にしない
});

test("Node（window が無い）でも読み込めて、currentInstallState・currentPlatform は落ちない", () => {
  assert.equal(PWA_EVENT, "a-pwa-change");
  assert.equal(currentInstallState(), "menu");
  assert.equal(currentPlatform(), "other");
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
