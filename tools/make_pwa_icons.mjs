// 新しい画面（app/）を PWA として入れたときのアイコンの PNG を、元の SVG から書き出す道具。説明：docs/app-screens.md §15
// CI では動かさない（tests/ には置かない）。サイトには npm の依存を入れないので、Playwright は手元のものを使う。
//
// 使い方（リポジトリの根で）
//   1. 絵を替えるときは、次の2つの SVG を差し替える（大きさは 512×512 の正方形。viewBox="0 0 512 512"）
//        app/img/pwa/icon.svg           … any 用。そのまま見せる場所（PC・タスクの一覧など）。角を丸めた形・透明な角でもよい
//        app/img/pwa/icon-maskable.svg  … maskable 用。Android が丸・角丸に切り抜く。地は端まで塗り、
//                                          大事な形は中央 80% の円（半径 205）の内側に収める。iPhone のアイコンもこちらから作る
//   2. 書き出す
//        NODE_PATH=$(npm root -g) node tools/make_pwa_icons.mjs
//      Playwright が無ければ：npm i -g playwright && npx playwright install chromium
//      Chromium の場所を指定するとき：CHROMIUM_PATH=/opt/pw-browsers/chromium（このリポジトリの作業環境）
//      プロキシの下では HTTPS_PROXY をそのまま渡す（文字の Shippori Mincho を Google Fonts から読むため）
//   3. 出る物（app/img/pwa/。名前は manifest.webmanifest と app/index.html が読む名前と同じ）
//        icon-96.png・icon-192.png・icon-512.png（any）
//        icon-maskable-96.png・icon-maskable-192.png・icon-maskable-512.png（maskable。96 は長押しのショートカット用）
//        apple-touch-icon.png（180。iPhone のホーム画面）
//   4. 絵を替えたら app/sw.js の VERSION を1つ上げる（古いアイコンを保存したままにしないため）
//
// SVG の文字は、Google Fonts の Shippori Mincho（700）を読んでから描く。読めないときは手元の明朝・serif で描いて、そう知らせる。
// maskable の絵は、書き出したあとに中央 80% の円の外に地と違う色が無いかを調べて知らせる（欠ける心配のある絵）。
import { readFileSync, writeFileSync, existsSync } from "node:fs";
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
const FONT_CSS = "https://fonts.googleapis.com/css2?family=Shippori+Mincho:wght@500;700&display=block";

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
  for (const out of OUTPUTS) {
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
} finally {
  await browser.close();
}
console.log(warned ? `書き出しました（注意 ${warned} 件）。` : "書き出しました。");

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
