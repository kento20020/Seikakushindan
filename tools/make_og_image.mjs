// 新しい画面（app/）のリンクの見た目（OGP）の絵 app/img/og/og-1200x630.jpg を書き出す道具。説明：docs/app-screens.md §21（決定 U45）
// CI では動かさない（tests/ には置かない）。サイトには npm の依存を入れないので、Playwright は手元のものを使う（tools/make_pwa_icons.mjs と同じ流儀）。
//
// 使い方（リポジトリの根で）
//   1. 書き出す
//        NODE_PATH=$(npm root -g) node tools/make_og_image.mjs
//      Playwright が無ければ：npm i -g playwright && npx playwright install chromium
//      Chromium の場所を指定するとき：CHROMIUM_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome（この作業環境）
//      プロキシの下では HTTPS_PROXY をそのまま渡す（文字の Shippori Mincho を Google Fonts から読むため）
//   2. Chromium が Google Fonts を読めないとき（プロキシの証明書で失敗するなど）は、文字のファイルを手元に落として渡す
//        a. 絵に使う文字を出す：node tools/make_og_image.mjs --chars
//        b. curl で、その文字だけの Shippori Mincho（700 と 500）の CSS を取り、中の url(...) のファイルを落とす。
//           置き場所はリポジトリの外（作業用の場所）。文字のファイルはリポジトリに入れない
//             curl -sS "https://fonts.googleapis.com/css2?family=Shippori+Mincho:wght@700&text=<a の文字を URL に直したもの>"
//        c. OG_FONT_700=<落としたファイル> OG_FONT_500=<落としたファイル> を付けて 1 を動かす（500 が無ければ 700 で描く）
//      TLS の検証を切る・HTTPS_PROXY を外す、はしない
//   3. 出る物：app/img/og/og-1200x630.jpg（1200×630、JPEG。200KB 以下が目安。超えたら知らせる）
//        書き出したら、画像を開いて、日本語が豆腐（□）になっていないこと・見た目が整っていることを目で確かめる
//   4. app/index.html の og:image は絶対 URL（https://kento20020.github.io/Seikakushindan/app/img/og/og-1200x630.jpg）。
//      読みに来る側（LINE・X など）は絵を覚えておくので、絵を替えたらファイルの名前を替える（例 og-1200x630-2.jpg）と早く替わる。
//      app/sw.js の殻には入れない（アプリの画面では使わないため）
//
// 絵の中身（替えるときは下の COPY・ART を直す）
//   地は #ECE6DE（app/ の地）。真ん中に大きく「喧嘩の答え」（Shippori Mincho 700）、細い線、その下に小さく2行。
//   左右の端に軸の絵（app/img/axes/*.jpg）を飾りとして置き、内側と縁をぼかして地に溶かす（明るさを上げて灰色の地を地の色に寄せる。app/ のホームと同じ）。
//   LINE などは真ん中の正方形（630×630）に切り抜くことがあるので、文字はすべて真ん中の 630×630 の中に収める（書き出すときに確かめる）
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, extname } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = join(ROOT, "app/img/og");
const OUT = join(OUT_DIR, "og-1200x630.jpg");
const W = 1200, H = 630;
const SAFE = 630;                 // 真ん中の正方形（文字はこの中に）
const MAX_BYTES = 200 * 1024;     // 目安
const QUALITY = 86;               // JPEG の質

const BG = "#ECE6DE";             // app/ の地（--bg）
const INK = "#2A2733";            // 文字（--ink）
const INK2 = "#4A4652";           // 文字2（--ink-2）
const ROSE = "#A15E58";           // 主の色（--rose）
const COPY = {
  title: "喧嘩の答え",
  lines: ["恋人との喧嘩での動き方を整理する", "診断と相談"],
};
// 左右の飾りの絵（app/img/axes/。人物はどれも右を向いているので、左の絵が真ん中を向く）
//   size … 絵の大きさ（正方形）、x … 左の端の位置（負なら左にはみ出す）、y … 上の位置
//   angle・solid・clear … 真ん中の側のぼかし（CSS の linear-gradient）。angle の向きに、solid まではそのまま、clear で見えなくなる。
//     向きを少し下へ傾けて、頭は残し、体（白い服）は早めに地へ溶かす
const ART = [
  { file: "app/img/axes/5-a.jpg", size: 600, x: -160, y: 0, angle: 106, solid: 0.50, clear: 0.72 },
  { file: "app/img/axes/4-b.jpg", size: 600, x: W - 600 + 170, y: 0, angle: 252, solid: 0.58, clear: 0.74 },
];

const FONT_CSS = "https://fonts.googleapis.com/css2?family=Shippori+Mincho:wght@500;700&display=block";
const CHARS = [...new Set([...COPY.title, ...COPY.lines.join("")])].join("");

if (process.argv.includes("--chars")) {
  console.log(CHARS);
  console.log(`URL に直したもの：${encodeURIComponent(CHARS)}`);
  process.exit(0);
}

let chromium;
try {
  ({ chromium } = require("playwright"));
} catch {
  console.error("Playwright が見つかりません。NODE_PATH=$(npm root -g) を付けて動かすか、npm i -g playwright で入れてください。");
  process.exit(1);
}

const dataUrl = (path, type) => `data:${type};base64,${readFileSync(path).toString("base64")}`;
const FONT_TYPES = { ".woff2": ["font/woff2", "woff2"], ".woff": ["font/woff", "woff"], ".ttf": ["font/ttf", "truetype"], ".otf": ["font/otf", "opentype"] };

/** 手元の文字のファイル（OG_FONT_700・OG_FONT_500）があれば @font-face にする。無ければ Google Fonts の CSS を読む */
function fontHead() {
  const files = { 700: process.env.OG_FONT_700, 500: process.env.OG_FONT_500 || process.env.OG_FONT_700 };
  if (!files[700]) return { head: `<link rel="stylesheet" href="${FONT_CSS}">`, local: false };
  const faces = Object.entries(files).map(([weight, path]) => {
    if (!existsSync(path)) throw new Error(`文字のファイルがありません：${path}`);
    const [mime, format] = FONT_TYPES[extname(path).toLowerCase()] || ["font/ttf", "truetype"];
    return `@font-face{font-family:"Shippori Mincho";font-weight:${weight};font-style:normal;font-display:block;src:url(${dataUrl(path, mime)}) format("${format}")}`;
  });
  return { head: `<style>${faces.join("")}</style>`, local: true };
}

function artCss(a) {
  const pct = (v) => `${Math.round(v * 100)}%`;
  const mask = `linear-gradient(${a.angle}deg, #000 0, #000 ${pct(a.solid)}, transparent ${pct(a.clear)}), linear-gradient(to bottom, #000 0, #000 78%, transparent 100%)`;
  return `left:${a.x}px;top:${a.y}px;width:${a.size}px;height:${a.size}px;-webkit-mask-image:${mask};-webkit-mask-composite:source-in;mask-image:${mask};mask-composite:intersect`;
}

const font = fontHead();
const html = `<!doctype html><html lang="ja"><head><meta charset="utf-8">
${font.head}
<style>
  html,body{margin:0;width:${W}px;height:${H}px;background:${BG};overflow:hidden}
  body{position:relative;font-family:"Shippori Mincho",serif;color:${INK};-webkit-font-smoothing:antialiased}
  .art{position:absolute;display:block;filter:brightness(1.14)}
  .copy{position:absolute;left:${(W - SAFE) / 2}px;top:0;width:${SAFE}px;height:${H}px;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center}
  .title{margin:0;font-weight:700;font-size:100px;line-height:1.2;letter-spacing:0.12em;padding-left:0.12em;white-space:nowrap}
  .rule{width:56px;height:2px;margin:34px 0 30px;background:${ROSE};opacity:0.85}
  .lines{margin:0;font-weight:500;font-size:30px;line-height:1.85;letter-spacing:0.14em;padding-left:0.14em;color:${INK2};white-space:nowrap}
</style></head><body>
${ART.map((a, i) => `<img class="art" id="art${i}" alt="" src="${dataUrl(join(ROOT, a.file), "image/jpeg")}" style="${artCss(a)}">`).join("\n")}
<div class="copy" id="copy">
  <h1 class="title" id="title">${COPY.title}</h1>
  <div class="rule"></div>
  <p class="lines" id="lines">${COPY.lines.join("<br>")}</p>
</div>
</body></html>`;

const launch = {};
if (process.env.CHROMIUM_PATH) launch.executablePath = process.env.CHROMIUM_PATH;
if (process.env.HTTPS_PROXY && !font.local) launch.args = [`--proxy-server=${process.env.HTTPS_PROXY}`];

const browser = await chromium.launch(launch);
try {
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  await page.setContent(html, { waitUntil: "load" });
  // document.fonts.check だけでは足りない（CSS が読めず Shippori Mincho の面が1つも無いときも true になる）。
  // 読み終えた Shippori Mincho の面が、700 と 500（手元のファイルが1つなら 700 だけ）にあるかを見る
  const ok = await page.evaluate(async ({ chars, need }) => {
    try {
      await document.fonts.load(`700 100px "Shippori Mincho"`, chars);
      await document.fonts.load(`500 30px "Shippori Mincho"`, chars);
    } catch { /* 下で知らせる */ }
    await document.fonts.ready;
    const faces = [...document.fonts].filter((f) => f.family.replace(/["']/g, "") === "Shippori Mincho" && f.status === "loaded");
    return need.every((w) => faces.some((f) => String(f.weight) === w));
  }, { chars: CHARS, need: font.local && !process.env.OG_FONT_500 ? ["700"] : ["700", "500"] });
  if (!ok) {
    console.error("Shippori Mincho を読めませんでした（日本語が別の字体か豆腐になるため、書き出しません）。上の 2 の手順で、文字のファイルを OG_FONT_700 に渡してください。");
    process.exitCode = 1;
  } else {
    // 文字が真ん中の正方形（630×630）に収まっているか
    const box = await page.evaluate(() => {
      const r = (id) => document.getElementById(id).getBoundingClientRect();
      const t = r("title"), l = r("lines");
      return { left: Math.min(t.left, l.left), right: Math.max(t.right, l.right), top: t.top, bottom: l.bottom };
    });
    const lo = (W - SAFE) / 2, hi = lo + SAFE;
    if (box.left < lo || box.right > hi || box.top < 0 || box.bottom > H) {
      console.error(`文字が真ん中の ${SAFE}×${SAFE} からはみ出しています（左 ${box.left.toFixed(0)}・右 ${box.right.toFixed(0)}。${lo}〜${hi} に収める）。COPY の文か大きさを直してください。`);
      process.exitCode = 1;
    } else {
      mkdirSync(OUT_DIR, { recursive: true });
      const jpg = await page.screenshot({ type: "jpeg", quality: QUALITY, clip: { x: 0, y: 0, width: W, height: H } });
      writeFileSync(OUT, jpg);
      const kb = (jpg.length / 1024).toFixed(1);
      console.log(`app/img/og/og-1200x630.jpg  ${W}×${H}  ${kb} KB（文字：${font.local ? "手元のファイル" : "Google Fonts"}。文字の範囲 ${box.left.toFixed(0)}〜${box.right.toFixed(0)}px）`);
      if (jpg.length > MAX_BYTES) console.warn(`注意：${MAX_BYTES / 1024}KB の目安を超えています。QUALITY を下げてください。`);
      console.log("書き出しました。画像を開いて、文字が豆腐になっていないか・見た目を確かめてください。");
    }
  }
} finally {
  await browser.close();
}
