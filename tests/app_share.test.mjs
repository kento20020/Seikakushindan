// node tests/app_share.test.mjs
// 新しい画面（app/）の結果のシェアと、共有のリンクから来た人の入口のテスト。仕様：docs/app-screens.md §21（決定 U45）
//  - app/js/share.js：読み込んだだけで document・window・navigator を触らない（Node で読める）
//  - shareUrl：app/・app/index.html?dv=v3#result などから …/app/?from=share（ほかのクエリとハッシュは付けない。結果は載せない）
//  - shareTextCopy4（24問・持ち主の原稿の形。決定 U46。既定）：「恋コンパスで診断しました。」＋改行＋結果の画面のタイトル。答えがそろわないときは1行目だけ
//  - shareText4（24問・前の形。?rc=u44）：primary・flat・none・null。shareText3（三択）：見出しあり・なし
//  - shareResult：navigator.share に { title, text, url } が渡る。閉じた（AbortError）ときは何もしない
//  - readFromShare：?from=share・?dv=v3&from=share#home → ?dv=v3#home・?from=other は印なし・クエリなし
//  - markFromShare・fromShare：sessionStorage があればそこに、無ければこの読み込みの間だけ
//  - home.js の sharedNoteText：24問のときと三択のときの文
//  - リンクの見た目（OGP）：app/index.html の og:・twitter: が絶対 URL、絵 app/img/og/og-1200x630.jpg が 1200×630 の JPEG で 200KB 以下
import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  shareUrl, shareText4, shareTextCopy4, shareText3, copyBody, shareResult, readFromShare, markFromShare, fromShare, clearFromShare,
  SHARE_TITLE, SHARE_LEAD, FROM_SHARE_KEY, COPY_OK, COPY_NG,
} from "../app/js/share.js";
import { LEAD_TITLE4, computeResult4 } from "../js/engine4.js";
import { copyOf4 } from "../app/js/summary4.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

let fail = 0, pass = 0;
async function test(name, fn) {
  try { await fn(); pass++; console.log("OK   " + name); }
  catch (e) { fail++; console.log("FAIL " + name + "\n  " + (e.stack || e).toString().split("\n").slice(0, 6).join("\n  ")); }
}

const SITE = "https://kento20020.github.io/Seikakushindan/app/";

// ---------------------------------------------------------------- 共有のリンク
await test("shareUrl：app/ の入口に ?from=share（ほかのクエリとハッシュは付けない）", () => {
  const want = `${SITE}?from=share`;
  assert.equal(shareUrl(SITE), want);
  assert.equal(shareUrl(`${SITE}index.html?dv=v3#result`), want);
  assert.equal(shareUrl(`${SITE}?dv=v4#result`), want);
  assert.equal(shareUrl(`${SITE}#home`), want);
  assert.equal(shareUrl("http://127.0.0.1:8000/app/?dev=1#result"), "http://127.0.0.1:8000/app/?from=share");
});

await test("文の頭とコピーの中身", () => {
  assert.equal(SHARE_TITLE, "恋コンパス");
  assert.equal(SHARE_LEAD, "恋コンパスで診断しました。");
  assert.equal(copyBody("あ", `${SITE}?from=share`), `あ\n${SITE}?from=share`);
  assert.equal(COPY_OK, "共有する文とリンクをコピーしました");
  assert.equal(COPY_NG, "コピーできませんでした");
});

// ---------------------------------------------------------------- 共有の文
await test("shareTextCopy4（既定）：「恋コンパスで診断しました。」＋改行＋結果の画面と同じタイトル。答えがそろわないときは1行目だけ", () => {
  const ans = (v) => (v === null ? { status: "unknown", value: null } : { status: "answered", value: v });
  const of = (u, p, n) => computeResult4(Object.fromEntries([1, 2, 3, 4, 5, 6, 7, 8].flatMap((d) => [[`U${d}`, ans(u)], [`P${d}`, ans(p)], [`N${d}`, ans(n)]])));
  const c = copyOf4(of(1, 1, 1));
  assert.equal(shareTextCopy4(c), `恋コンパスで診断しました。\n${c.title}`);
  assert.equal(shareTextCopy4(c), "恋コンパスで診断しました。\n話して、ふたりの間をほどいていく。");
  assert.equal(shareTextCopy4(copyOf4(of(1, -1, null))), "恋コンパスで診断しました。\nいまの答えを、そのまま大切にする。");
  assert.equal(shareTextCopy4(copyOf4(of(null, null, null))), SHARE_LEAD, "答えがそろった領域が無い");
  assert.equal(shareTextCopy4(null), SHARE_LEAD);
  assert.equal(shareTextCopy4({ kind: "primary", title: " " }), SHARE_LEAD);
});

await test("shareText4：primary は「今回の回答で目立つ傾向：見出し」", () => {
  const lead = { kind: "primary", title: "「向き合う」を選びやすい", body: "…", domain: 1 };
  assert.equal(shareText4(lead), "恋コンパスで診断しました。\n今回の回答で目立つ傾向：「向き合う」を選びやすい");
});

await test("shareText4：flat は「見出しでした。」（LEAD_TITLE4.flat の今の文で、文として読める）", () => {
  assert.equal(LEAD_TITLE4.flat, "今回の回答では、片側に強く寄らない傾向");
  assert.equal(shareText4({ kind: "flat", title: LEAD_TITLE4.flat, body: "", domain: null }),
    "恋コンパスで診断しました。\n今回の回答では、片側に強く寄らない傾向でした。");
});

await test("shareText4：none・lead が無い・見出しが空は1行目だけ", () => {
  assert.equal(shareText4({ kind: "none", title: "", body: "判断できない問が多いため…", domain: null }), SHARE_LEAD);
  assert.equal(shareText4(null), SHARE_LEAD);
  assert.equal(shareText4(undefined), SHARE_LEAD);
  assert.equal(shareText4({ kind: "primary", title: "  " }), SHARE_LEAD);
  assert.equal(shareText4({ kind: "flat", title: "" }), SHARE_LEAD);
});

await test("shareText3：見出しがあれば「今回の主軸：見出し」、無ければ1行目だけ", () => {
  assert.equal(shareText3({ id: "B1-A", headline: "まず向き合って、言葉にする" }), "恋コンパスで診断しました。\n今回の主軸：まず向き合って、言葉にする");
  assert.equal(shareText3({ id: "x", headline: "" }), SHARE_LEAD);
  assert.equal(shareText3(null), SHARE_LEAD);
});

await test("文に結果の URL・回答を入れない（リンクは ?from=share だけ）", () => {
  const u = new URL(shareUrl(`${SITE}?dv=v3#result`));
  assert.deepEqual([...u.searchParams.keys()], ["from"]);
  assert.equal(u.hash, "");
});

// ---------------------------------------------------------------- 押したとき（共有の窓）
const navDesc = Object.getOwnPropertyDescriptor(globalThis, "navigator");
function withNavigator(nav, fn) {
  Object.defineProperty(globalThis, "navigator", { value: nav, configurable: true, writable: true });
  return Promise.resolve().then(fn).finally(() => {
    if (navDesc) Object.defineProperty(globalThis, "navigator", navDesc);
    else delete globalThis.navigator;
  });
}

await test("shareResult：navigator.share に { title, text, url } が渡る", async () => {
  const got = [];
  await withNavigator({ share: async (d) => { got.push(d); } }, async () => {
    const r = await shareResult({ text: shareText3({ headline: "見出し" }), url: `${SITE}?from=share` });
    assert.equal(r, "shared");
  });
  assert.deepEqual(got, [{ title: "恋コンパス", text: "恋コンパスで診断しました。\n今回の主軸：見出し", url: `${SITE}?from=share` }]);
});

await test("shareResult：閉じた（AbortError）ときは何もしない（コピーしない）", async () => {
  let copied = 0;
  await withNavigator({
    share: async () => { const e = new Error("閉じた"); e.name = "AbortError"; throw e; },
    clipboard: { writeText: async () => { copied++; } },
  }, async () => {
    assert.equal(await shareResult({ text: SHARE_LEAD, url: `${SITE}?from=share` }), "aborted");
  });
  assert.equal(copied, 0);
});

// ---------------------------------------------------------------- 共有のリンクから来た人
await test("readFromShare：?from=share を外す（ほかのクエリ・ハッシュは残す）", () => {
  assert.deepEqual(readFromShare(`${SITE}?from=share`), { shared: true, href: SITE });
  assert.deepEqual(readFromShare(`${SITE}?dv=v3&from=share#home`), { shared: true, href: `${SITE}?dv=v3#home` });
  assert.deepEqual(readFromShare(`${SITE}?from=share&dv=v4`), { shared: true, href: `${SITE}?dv=v4` });
  assert.deepEqual(readFromShare(`${SITE}index.html?from=share#result`), { shared: true, href: `${SITE}index.html#result` });
  // 書き方はそのまま（並べ直したり、エンコードし直したりしない）。from は全部外す
  assert.deepEqual(readFromShare(`${SITE}?a=1%202&from=share&from=x&b`), { shared: true, href: `${SITE}?a=1%202&b` });
});

await test("readFromShare：from=share が無ければ印なし・URL もそのまま", () => {
  assert.deepEqual(readFromShare(`${SITE}?from=other`), { shared: false, href: `${SITE}?from=other` });
  assert.deepEqual(readFromShare(SITE), { shared: false, href: SITE });
  assert.deepEqual(readFromShare(`${SITE}#home`), { shared: false, href: `${SITE}#home` });
  assert.deepEqual(readFromShare(`${SITE}?dv=v3#from=share`), { shared: false, href: `${SITE}?dv=v3#from=share` });
  assert.deepEqual(readFromShare("読めない"), { shared: false, href: "読めない" });
  assert.deepEqual(readFromShare(null), { shared: false, href: "" });
});

await test("markFromShare・fromShare：sessionStorage に印（キー a-from-share）", () => {
  const m = new Map();
  globalThis.sessionStorage = { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
  try {
    clearFromShare();
    assert.equal(fromShare(), false);
    markFromShare();
    assert.equal(m.get(FROM_SHARE_KEY), "1");
    assert.equal(fromShare(), true);
    clearFromShare();
    assert.equal(fromShare(), false);
    m.set(FROM_SHARE_KEY, "1");   // 同じタブで読み込み直したとき（前の読み込みで付けた印）
    assert.equal(fromShare(), true);
  } finally {
    clearFromShare();
    delete globalThis.sessionStorage;
  }
});

await test("markFromShare・fromShare：sessionStorage が使えないときは、この読み込みの間だけ覚える", () => {
  Object.defineProperty(globalThis, "sessionStorage", { get() { throw new Error("使えない"); }, configurable: true });
  try {
    clearFromShare();
    assert.equal(fromShare(), false);
    markFromShare();
    assert.equal(fromShare(), true);
  } finally {
    delete globalThis.sessionStorage;
    clearFromShare();
  }
  assert.equal(fromShare(), false);
});

await test("ホームの箱の文（24問のとき・三択のとき）", async () => {
  const { sharedNoteText } = await import("../app/js/home.js");
  assert.deepEqual(sharedNoteText(true), {
    title: "送られてきた診断です",
    body: "24問の「どっち？」に答えると、恋人との喧嘩での自分の動き方の傾向が分かります。送った人の結果は、その人の端末の中にだけあり、ここには出ません。",
  });
  assert.equal(sharedNoteText(false).body, "質問に答えると、恋人との喧嘩での自分の動き方の傾向が分かります。送った人の結果は、その人の端末の中にだけあり、ここには出ません。");
});

// ---------------------------------------------------------------- リンクの見た目（OGP）
const html = readFileSync(join(ROOT, "app/index.html"), "utf8");
const meta = (attr, name) => {
  const m = html.match(new RegExp(`<meta ${attr}="${name.replace(/[.:]/g, "\\$&")}" content="([^"]*)">`));
  return m ? m[1] : null;
};

await test("OGP：要る項目があり、URL は絶対 URL", () => {
  assert.equal(meta("property", "og:type"), "website");
  assert.equal(meta("property", "og:site_name"), "恋コンパス");
  assert.equal(meta("property", "og:title"), "恋コンパス");
  assert.equal(meta("property", "og:description"), "恋人との喧嘩での動き方を、24問の「どっち？」で整理する診断と、次の一手を一緒に考える相談（試作）");
  assert.equal(meta("property", "og:url"), SITE);
  assert.equal(meta("property", "og:image"), `${SITE}img/og/og-1200x630.jpg`);
  assert.equal(meta("property", "og:image:width"), "1200");
  assert.equal(meta("property", "og:image:height"), "630");
  assert.equal(meta("property", "og:image:alt"), "恋コンパス");
  assert.equal(meta("property", "og:locale"), "ja_JP");
  assert.equal(meta("name", "twitter:card"), "summary_large_image");
  for (const k of ["og:url", "og:image"]) assert.match(meta("property", k), /^https:\/\//);
  // 今までの物は変えない
  assert.match(html, /<title>恋コンパス（試作）<\/title>/);
  assert.match(html, /<meta name="robots" content="noindex">/);
});

/** JPEG の SOF から幅と高さを読む */
function jpegSize(path) {
  const b = readFileSync(path);
  assert.equal(b.readUInt16BE(0), 0xffd8, `JPEG ではありません：${path}`);
  let i = 2;
  while (i < b.length) {
    assert.equal(b[i], 0xff);
    const marker = b[i + 1];
    const len = b.readUInt16BE(i + 2);
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) };
    i += 2 + len;
  }
  throw new Error("SOF がありません");
}

await test("OGP の絵：app/img/og/og-1200x630.jpg が 1200×630 の JPEG で 200KB 以下", () => {
  const path = join(ROOT, "app/img/og/og-1200x630.jpg");
  assert.deepEqual(jpegSize(path), { width: 1200, height: 630 });
  assert.ok(statSync(path).size <= 200 * 1024, `${statSync(path).size} バイト`);
});

await test("OGP の絵は service worker の殻に入れない", () => {
  const sw = readFileSync(join(ROOT, "app/sw.js"), "utf8");
  assert.doesNotMatch(sw.match(/const SHELL = \[([\s\S]*?)\];/)[1], /img\/og\//);
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
