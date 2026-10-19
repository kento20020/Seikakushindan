// 新しい画面（app/）を PWA として入れたときのアイコンと iPhone の起動画面の PNG を、元の SVG から書き出す道具。説明：docs/app-screens.md §15（起動画面は §15.10）
// CI では動かさない（tests/ には置かない）。サイトには npm の依存を入れないので、Playwright は手元のものを使う。
//
// 使い方（リポジトリの根で）
//   1. 絵を替えるときは、次の2つの SVG を差し替える（大きさは 512×512 の正方形。viewBox="0 0 512 512"）
//        app/img/pwa/icon.svg           … any 用。そのまま見せる場所（PC・タスクの一覧など）。角を丸めた形・透明な角でもよい
//        app/img/pwa/icon-maskable.svg  … maskable 用。Android が丸・角丸に切り抜く。地は端まで塗り、
//                                          大事な形は中央 80% の円（半径 205）の内側に収める。iPhone のアイコンもこちらから作る
//   2. 書き出す
//        NODE_PATH=$(npm root -g) node tools/make_pwa_icons.mjs          … アイコンと起動画面の両方
//        NODE_PATH=$(npm root -g) node tools/make_pwa_icons.mjs icons    … アイコンだけ
//        NODE_PATH=$(npm root -g) node tools/make_pwa_icons.mjs splash   … iPhone の起動画面だけ
//      Playwright が無ければ：npm i -g playwright && npx playwright install chromium
//      Chromium の場所を指定するとき：CHROMIUM_PATH=/opt/pw-browsers/chromium（このリポジトリの作業環境）
//      プロキシの下では HTTPS_PROXY をそのまま渡す（文字の Shippori Mincho を Google Fonts から読むため）
//   3. 出る物（app/img/pwa/。名前は manifest.webmanifest と app/index.html が読む名前と同じ）
//        icon-96.png・icon-192.png・icon-512.png（any）
//        icon-maskable-96.png・icon-maskable-192.png・icon-maskable-512.png（maskable。96 は長押しのショートカット用）
//        apple-touch-icon.png（180。iPhone のホーム画面）
//        splash/splash-<幅>x<高さ>.png（iPhone の起動画面。下の表 SPLASH の12枚。決定 U37）
//          地は manifest の background_color（#ECE6DE）を端まで、真ん中に icon.svg（any）を短い辺の 28% の大きさで、少し上（高さの 45%）に置く。
//          日本語の文字は足さない（フォントが無い環境で豆腐になるため）。iPhone の縦向きだけ（iPad・横向きは作らない）
//          書き出したあと、app/index.html に入れる <link rel="apple-touch-startup-image"> の行を出す（表を変えたら index.html も合わせる）
//   4. 絵を替えたら app/sw.js の VERSION を1つ上げる（古いアイコンを保存したままにしないため）。起動画面は sw.js の殻に入れない
//
// SVG の文字は、Google Fonts の Shippori Mincho（700）を読んでから描く。読めないときは手元の明朝・serif で描いて、そう知らせる。
// maskable の絵は、書き出したあとに中央 80% の円の外に地と違う色が無いかを調べて知らせる（欠ける心配のある絵）。
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIR = join(ROOT, "app/img/pwa");

// 書き出す物の表（足すときはここに1行。manifest.webmanifest にも書く）
const OUTPUTS = [
  { src: "icon.svg", file: "icon-96.png", size: 96 },
  { src: "icon.svg", file: "icon-192.png", size: 192 },
  { src: "icon.svg", file: "icon-512.png", size: 512 },
  { src: "icon-maskable.svg", file: "icon-maskable-96.png", size: 96, maskable: true },
  { src: "icon-maskable.svg", file: "icon-maskable-192.png", size: 192, maskable: true },
  { src: "icon-maskable.svg", file: "icon-maskable-512.png", size: 512, maskable: true },
  { src: "icon-maskable.svg", file: "apple-touch-icon.png", size: 180 },
];
// iPhone の起動画面（apple-touch-startup-image）。CSS の幅×高さ（縦向き）と倍率。PNG はその掛け算の画素。新しい機種が出たらここに1行
//   media が端末と合わないと出ない（白か地の色の画面になる）。主な機種は目安（2026-10 時点）
const SPLASH = [
  { w: 440, h: 956, r: 3, note: "iPhone 16 Pro Max・17 Pro Max" },
  { w: 402, h: 874, r: 3, note: "iPhone 16 Pro・17・17 Pro" },
  { w: 430, h: 932, r: 3, note: "iPhone 14 Pro Max・15 Plus・15 Pro Max・16 Plus" },
  { w: 420, h: 912, r: 3, note: "iPhone Air" },
  { w: 393, h: 852, r: 3, note: "iPhone 14 Pro・15・15 Pro・16" },
  { w: 428, h: 926, r: 3, note: "iPhone 12 Pro Max・13 Pro Max・14 Plus" },
  { w: 390, h: 844, r: 3, note: "iPhone 12・12 Pro・13・13 Pro・14・16e" },
  { w: 375, h: 812, r: 3, note: "iPhone X・XS・11 Pro・12 mini・13 mini" },
  { w: 414, h: 896, r: 3, note: "iPhone XS Max・11 Pro Max" },
  { w: 414, h: 896, r: 2, note: "iPhone XR・11" },
  { w: 414, h: 736, r: 3, note: "iPhone 6s Plus・7 Plus・8 Plus" },
  { w: 375, h: 667, r: 2, note: "iPhone 6s・7・8・SE（第2・第3世代）" },
];
const SPLASH_BG = "#ECE6DE";    // manifest.webmanifest の background_color と同じ
const SPLASH_ICON = 0.28;       // 絵の大きさ（短い辺に対する割合）
const SPLASH_Y = 0.45;          // 絵の中心の高さ（上からの割合）
const FONT_CSS = "https://fonts.googleapis.com/css2?family=Shippori+Mincho:wght@500;700&display=block";
const which = process.argv[2] || "all";
if (!["all", "icons", "splash"].includes(which)) {
  console.error(`知らない指定です：${which}（icons・splash のどちらか。省略で両方）`);
  process.exit(1);
}

let chromium;
try {
  ({ chromium } = require("playwright"));
} catch {
  console.error("Playwright が見つかりません。NODE_PATH=$(npm root -g) を付けて動かすか、npm i -g playwright で入れてください。");
  process.exit(1);
}

const launch = {};
if (process.env.CHROMIUM_PATH) launch.executablePath = process.env.CHROMIUM_PATH;
if (process.env.HTTPS_PROXY) launch.args = [`--proxy-server=${process.env.HTTPS_PROXY}`];

const browser = await chromium.launch(launch);
const page = await browser.newPage({ deviceScaleFactor: 1 });
let warned = 0;
try {
  for (const out of which === "splash" ? [] : OUTPUTS) {
    const srcPath = join(DIR, out.src);
    if (!existsSync(srcPath)) throw new Error(`元の SVG がありません：app/img/pwa/${out.src}`);
    const svg = readFileSync(srcPath, "utf8");
    await page.setViewportSize({ width: out.size, height: out.size });
    await page.setContent(`<!doctype html><html><head><meta charset="utf-8">
      <link rel="stylesheet" href="${FONT_CSS}">
      <style>html,body{margin:0;background:transparent}#box{width:${out.size}px;height:${out.size}px}#box>svg{display:block;width:100%;height:100%}</style>
      </head><body><div id="box">${svg}</div></body></html>`, { waitUntil: "load" });
    const font = await page.evaluate(async () => {
      try { await document.fonts.load('700 64px "Shippori Mincho"', "16"); } catch { /* 読めないときは下で知らせる */ }
      await document.fonts.ready;
      return document.fonts.check('700 64px "Shippori Mincho"', "16");
    });
    if (!font && svg.includes("Shippori Mincho")) {
      warned++;
      console.warn(`注意：Shippori Mincho を読めなかったので、手元の明朝・serif で描きました（${out.file}）`);
    }
    const png = await page.locator("#box").screenshot({ omitBackground: true, type: "png" });
    writeFileSync(join(DIR, out.file), png);

    let note = "";
    if (out.maskable) {
      const outside = await outsideSafeZone(page, png, out.size);
      if (outside > 0) { warned++; note = `  注意：中央 80% の円の外に、地と違う色の点が ${outside} 個あります（丸く切られると欠けるかもしれません）`; }
    }
    console.log(`app/img/pwa/${out.file}  ${out.size}×${out.size}  ${png.length} バイト（元：${out.src}）${note}`);
  }
  if (which !== "icons") warned += await writeSplash(page);
} finally {
  await browser.close();
}
console.log(warned ? `書き出しました（注意 ${warned} 件）。` : "書き出しました。");

/** iPhone の起動画面（SPLASH の表）を app/img/pwa/splash/ に書き出し、index.html に入れる <link> の行を出す → 注意の数 */
async function writeSplash(pg) {
  const srcPath = join(DIR, "icon.svg");
  if (!existsSync(srcPath)) throw new Error("元の SVG がありません：app/img/pwa/icon.svg");
  const svg = readFileSync(srcPath, "utf8");
  const outDir = join(DIR, "splash");
  mkdirSync(outDir, { recursive: true });
  let warn = 0, total = 0;
  const links = [];
  for (const sp of SPLASH) {
    const W = sp.w * sp.r, H = sp.h * sp.r;
    const size = Math.round(Math.min(W, H) * SPLASH_ICON);
    const left = Math.round((W - size) / 2), top = Math.round(H * SPLASH_Y - size / 2);
    await pg.setViewportSize({ width: W, height: H });
    await pg.setContent(`<!doctype html><html><head><meta charset="utf-8">
      <link rel="stylesheet" href="${FONT_CSS}">
      <style>html,body{margin:0;width:${W}px;height:${H}px;background:${SPLASH_BG};overflow:hidden}
      #art{position:absolute;left:${left}px;top:${top}px;width:${size}px;height:${size}px}#art>svg{display:block;width:100%;height:100%}</style>
      </head><body><div id="art">${svg}</div></body></html>`, { waitUntil: "load" });
    const font = await pg.evaluate(async () => {
      try { await document.fonts.load('700 64px "Shippori Mincho"', "16"); } catch { /* 下で知らせる */ }
      await document.fonts.ready;
      return document.fonts.check('700 64px "Shippori Mincho"', "16");
    });
    if (!font && svg.includes("Shippori Mincho")) { warn++; console.warn(`注意：Shippori Mincho を読めなかったので、手元の明朝・serif で描きました（splash-${W}x${H}.png）`); }
    const file = `splash-${W}x${H}.png`;
    const png = await pg.screenshot({ type: "png", clip: { x: 0, y: 0, width: W, height: H } });
    writeFileSync(join(outDir, file), png);
    total += png.length;
    console.log(`app/img/pwa/splash/${file}  ${W}×${H}  ${png.length} バイト（${sp.w}×${sp.h} @${sp.r}x。${sp.note}）`);
    links.push(`<link rel="apple-touch-startup-image" href="./img/pwa/splash/${file}" media="screen and (device-width: ${sp.w}px) and (device-height: ${sp.h}px) and (-webkit-device-pixel-ratio: ${sp.r}) and (orientation: portrait)">`);
  }
  console.log(`起動画面 ${SPLASH.length} 枚、合わせて ${(total / 1024).toFixed(1)} KB`);
  console.log("\napp/index.html の <head> に入れる行（今の行と違えば差し替える）：");
  for (const l of links) console.log(l);
  return warn;
}

/** maskable の PNG の、中央 80% の円の外で、左上の色（地）と大きく違う点の数 */
async function outsideSafeZone(pg, png, size) {
  const url = `data:image/png;base64,${png.toString("base64")}`;
  return pg.evaluate(async ({ url, size }) => {
    const img = new Image();
    img.src = url;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = c.height = size;
    const ctx = c.getContext("2d");
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, size, size).data;
    const bg = [d[0], d[1], d[2]];
    const r = size * 0.4, mid = size / 2;
    let n = 0;
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      if (Math.hypot(x + 0.5 - mid, y + 0.5 - mid) <= r) continue;
      const i = (y * size + x) * 4;
      if (Math.abs(d[i] - bg[0]) + Math.abs(d[i + 1] - bg[1]) + Math.abs(d[i + 2] - bg[2]) > 24) n++;
    }
    return n;
  }, { url, size });
}
