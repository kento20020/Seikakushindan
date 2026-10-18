// node tests/ui_flags.test.mjs
// 見た目の版（?ui=v1|v2）・開発用の表示（?dev=1）・スワイプの形（?sw=）の切り替えと、トークン・v2 の CSS・アイコンの決まりのテスト。仕様：docs/design-tokens.md
//  - resolveUiFlags（js/ui_flags.js）の判定。index.html の既定（data-ui-default）と js 側の既定が食い違わない
//  - index.html の先頭のスクリプトが、resolveUiFlags と同じ判定で <html> に data-ui・data-dev を付ける（vm で実際に走らせて比べる）
//  - CSS の読み込み順（tokens.css → style.css → consult.css → ui2.css）
//  - css/ui2.css のセレクタはすべて :root[data-ui="v2"] の下（v1 には効かない）。古い変数名をすべて役割の値に結び直している
//  - css/tokens.css は変数の定義だけ。v1 の変数名と重なるのは --gutter だけで、style.css が上書きする
//  - 色のトークンのコントラスト（文字 4.5:1 以上、部品の枠・フォーカス 3:1 以上）
//  - 開発・検証用の表示を隠す CSS（dev-only・user-only）
//  - img/icons.svg の <symbol> と ICON_NAMES（js/ui/dom.js）が一致し、線のアイコンの決まり（viewBox 24・線 1.5・塗りなし・currentColor）を守る
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { resolveUiFlags, keepUiParams, DEFAULT_UI, UI_VERSIONS, SWIPE_VARIANTS, DEFAULT_SWIPE } from "../js/ui_flags.js";
import { ICON_NAMES } from "../js/ui/dom.js";

const ROOT = new URL("../", import.meta.url);
const read = (p) => readFileSync(new URL(p, ROOT), "utf8");

let fail = 0, pass = 0;
function test(name, fn) {
  try { fn(); pass++; console.log("OK   " + name); }
  catch (e) { fail++; console.log("FAIL " + name + "\n  " + (e.stack || e).toString().split("\n").slice(0, 6).join("\n  ")); }
}

// ---------------------------------------------------------------- 素朴な CSS パーサ（コメントを除き、@media の入れ子を1段まで）
function parseCss(src) {
  src = src.replace(/\/\*[\s\S]*?\*\//g, "");
  const out = [];
  let i = 0;
  function block(media) {
    while (i < src.length) {
      const close = src.indexOf("}", i), open = src.indexOf("{", i);
      if (close !== -1 && (open === -1 || close < open)) { i = close + 1; return; }
      if (open === -1) { i = src.length; return; }
      const prelude = src.slice(i, open).trim();
      i = open + 1;
      if (prelude.startsWith("@media") || prelude.startsWith("@supports")) { block(prelude); continue; }
      if (prelude.startsWith("@keyframes")) { let depth = 1; while (depth && i < src.length) { if (src[i] === "{") depth++; else if (src[i] === "}") depth--; i++; } continue; }
      const end = src.indexOf("}", i);
      const body = src.slice(i, end);
      i = end + 1;
      const decls = body.split(";").map(s => s.trim()).filter(Boolean).map(s => { const k = s.indexOf(":"); return [s.slice(0, k).trim(), s.slice(k + 1).trim()]; });
      out.push({ media, selector: prelude.replace(/\s+/g, " "), decls });
    }
  }
  block(null);
  return out;
}
/** セレクタの並び（a, b）を、括弧の外のカンマだけで分ける（:is(a, b) の中は分けない） */
function splitSelectors(sel) {
  const parts = []; let depth = 0, cur = "";
  for (const ch of sel) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) { parts.push(cur.trim()); cur = ""; } else cur += ch;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}
const rootVarNames = (rules) => new Set(rules.filter(r => r.selector === ":root").flatMap(r => r.decls.map(([k]) => k)).filter(k => k.startsWith("--")));

// ================================================================ resolveUiFlags
test("resolveUiFlags：?ui= が無い・知らない値なら既定（v1）、v1・v2 はそのまま", () => {
  assert.equal(DEFAULT_UI, "v1");
  assert.deepEqual(UI_VERSIONS, ["v1", "v2"]);
  assert.deepEqual(resolveUiFlags(""), { ui: "v1", dev: false, fb: false, sw: "c" });
  assert.deepEqual(resolveUiFlags("?ui=v2"), { ui: "v2", dev: false, fb: false, sw: "c" });
  assert.deepEqual(resolveUiFlags("?ui=v1"), { ui: "v1", dev: false, fb: false, sw: "c" });
  for (const s of ["?ui=v3", "?ui=V2", "?ui=", "?ui", "?ui=v2x", "?five=1"]) assert.equal(resolveUiFlags(s).ui, "v1", s);
  assert.equal(resolveUiFlags("ui=v2").ui, "v2", "先頭の ? は無くてもよい");
  assert.equal(resolveUiFlags("?ui=v2&ui=v1").ui, "v2", "同じ名前が2つあれば最初の値（URLSearchParams.get と同じ）");
  assert.equal(resolveUiFlags(undefined).ui, "v1");
  assert.equal(resolveUiFlags(null).ui, "v1");
});

test("resolveUiFlags：既定の版を変えられる（data-ui-default）。知らない既定は v1", () => {
  assert.equal(resolveUiFlags("", "v2").ui, "v2");
  assert.equal(resolveUiFlags("?ui=v1", "v2").ui, "v1", "?ui=v1 でいつでも今の見た目に戻せる");
  assert.equal(resolveUiFlags("?ui=v9", "v2").ui, "v2");
  assert.equal(resolveUiFlags("", "v7").ui, "v1");
  assert.equal(resolveUiFlags("", "").ui, "v1");
});

test("resolveUiFlags：?dev=1・?fb=1 のときだけ true", () => {
  assert.equal(resolveUiFlags("?dev=1").dev, true);
  for (const s of ["?dev=0", "?dev=true", "?dev=", "?dev", "?devx=1", ""]) assert.equal(resolveUiFlags(s).dev, false, s);
  assert.equal(resolveUiFlags("?fb=1").fb, true);
  assert.equal(resolveUiFlags("?fb=0").fb, false);
  assert.deepEqual(resolveUiFlags("?qv=v2&ui=v2&dev=1&fb=1"), { ui: "v2", dev: true, fb: true, sw: "c" });
});

test("resolveUiFlags：?sw= はスワイプの形（card・a・b・c）。無い・知らない値なら既定（c。決定 U28）", () => {
  assert.equal(DEFAULT_SWIPE, "c");
  assert.deepEqual(SWIPE_VARIANTS, ["card", "a", "b", "c"]);
  for (const v of SWIPE_VARIANTS) assert.equal(resolveUiFlags(`?sw=${v}`).sw, v, v);
  for (const s of ["", "?sw=", "?sw=A", "?sw=d"]) assert.equal(resolveUiFlags(s).sw, "c", s);
  assert.deepEqual(resolveUiFlags("?ui=v2&dev=1&qv=v1&fb=1&sw=a"), { ui: "v2", dev: true, fb: true, sw: "a" }, "ほかのクエリと組み合わせられる");
});

test("keepUiParams：別ページへのリンクに ?ui= ?dev= ?sw= を引き継ぐ（ほかのクエリは引き継がない）", () => {
  assert.equal(String(keepUiParams({ five: "1" }, "?ui=v2&dev=1&fb=1&qv=v1")), "five=1&ui=v2&dev=1");
  assert.equal(String(keepUiParams({ five: "1" }, "?sw=b&ui=v2&qv=v1")), "five=1&ui=v2&sw=b");
  assert.equal(String(keepUiParams({ five: "1" }, "")), "five=1");
  assert.equal(String(keepUiParams({ five: "1", ui: "v1" }, "?ui=v2")), "five=1&ui=v1", "リンク側で決めた値はそのまま");
});

// ================================================================ index.html
const html = read("index.html");

test("index.html の既定（data-ui-default）と js/ui_flags.js の DEFAULT_UI が同じ", () => {
  const m = html.match(/<html\b[^>]*\bdata-ui-default="([^"]*)"/);
  assert.ok(m, "<html> に data-ui-default がある");
  assert.equal(m[1], DEFAULT_UI);
});

/** index.html の先頭のスクリプト（type なしの <script>）を、作り物の document・location で走らせて <html> の属性を返す */
function runHeadScript(search, uiDefault) {
  const m = html.match(/<script>([\s\S]*?)<\/script>/);
  assert.ok(m, "type なしの <script> がある");
  const attrs = { "data-ui-default": uiDefault };
  const documentElement = {
    getAttribute: (k) => (k in attrs ? attrs[k] : null),
    setAttribute: (k, v) => { attrs[k] = String(v); },
  };
  vm.runInNewContext(m[1], { document: { documentElement }, location: { search }, URLSearchParams });
  return attrs;
}

test("index.html の先頭のスクリプトは resolveUiFlags と同じ判定で data-ui・data-dev を付ける", () => {
  const searches = ["", "?ui=v2", "?ui=v1", "?ui=v3", "?ui=V2", "?dev=1", "?dev=0", "?ui=v2&dev=1", "?fb=1&dev=1", "?qv=v2&ui=v2", "?ui=v2&ui=v1", "?ui=", "?dev=true"];
  for (const def of ["v1", "v2", "zz"]) {
    for (const s of searches) {
      const a = runHeadScript(s, def), f = resolveUiFlags(s, def);
      assert.equal(a["data-ui"], f.ui, `${s}（既定 ${def}）`);
      assert.equal(a["data-dev"] === "1", f.dev, `${s} の dev`);
    }
  }
});

test("index.html：先頭のスクリプトが CSS より前、CSS は tokens → style → consult → ui2 の順", () => {
  const pos = (needle) => { const i = html.indexOf(needle); assert.ok(i >= 0, `${needle} がある`); return i; };
  const script = pos("<script>"), tokens = pos('href="./css/tokens.css"'), style = pos('href="./css/style.css"'),
    consult = pos('href="./css/consult.css"'), ui2 = pos('href="./css/ui2.css"');
  assert.ok(script < tokens && tokens < style && style < consult && consult < ui2);
  assert.ok(html.indexOf("localStorage") < 0 || html.indexOf("localStorage") > html.indexOf("</script>"), "先頭のスクリプトは保存しない（URL だけで決める）");
});

test("index.html：ヘッダーの「（試作）」と足元の担当者用リンクは開発・検証用、足元に利用者向けの一行", () => {
  assert.match(html, /<a class="head-link"[^>]*>相談<span class="dev-only">（試作）<\/span><\/a>/);
  assert.match(html, /<p class="dev-only">[^\n]*admin\.html[^\n]*\?five=1#diagnose[^\n]*<\/p>/);
  assert.match(html, /<p class="user-only[^"]*">試作中のサービスです/);
  assert.match(html, /判定はすべてこのブラウザの中で計算しています/, "判定が端末の中で行われる説明は利用者向けに残す");
});

// ================================================================ CSS
const tokensCss = read("css/tokens.css"), styleCss = read("css/style.css"), consultCss = read("css/consult.css"), ui2Css = read("css/ui2.css");
const tokenRules = parseCss(tokensCss), styleRules = parseCss(styleCss), consultRules = parseCss(consultCss), ui2Rules = parseCss(ui2Css);

test("css/ui2.css：すべてのセレクタが :root[data-ui=\"v2\"] で始まる（v1 には効かない）", () => {
  assert.ok(ui2Rules.length > 100, "規則が読めている");
  const bad = [];
  for (const r of ui2Rules) for (const s of splitSelectors(r.selector)) if (!s.startsWith(':root[data-ui="v2"]')) bad.push(`${r.media ?? ""} ${s}`);
  assert.deepEqual(bad, []);
  assert.ok(!/@import|url\(\s*["']?https?:/i.test(ui2Css), "外部の読み込みがない");
});

test("css/ui2.css：style.css・consult.css の :root の古い変数名を、すべて役割の値に結び直している", () => {
  const old = new Set([...rootVarNames(styleRules), ...rootVarNames(consultRules)]);
  old.delete("--ti-bg");   // 絵の背景のグレー（絵の四隅の色。見た目の版では変えない）
  const mapped = new Map(ui2Rules.filter(r => r.selector === ':root[data-ui="v2"]' && !r.media).flatMap(r => r.decls));
  const missing = [...old].filter(k => !mapped.has(k));
  assert.deepEqual(missing, []);
  for (const [k, v] of mapped) if (old.has(k)) assert.match(v, /^var\(--(color|font|radius|gutter)-[a-z0-9-]+\)$/, `${k} は役割の値で結ぶ（${v}）`);
  assert.equal(mapped.get("--serif"), "var(--font-sans)", "明朝は使わない");
});

test("css/tokens.css：:root の変数の定義だけ。v1 の変数名と重なるのは --gutter だけで、style.css の :root が上書きする", () => {
  for (const r of tokenRules) {
    assert.equal(r.selector, ":root", `${r.media ?? ""} ${r.selector}`);
    for (const [k] of r.decls) assert.ok(k.startsWith("--"), `変数以外の宣言 ${k}`);
  }
  const tokenNames = rootVarNames(tokenRules);
  const v1Names = new Set([...rootVarNames(styleRules), ...rootVarNames(consultRules)]);
  assert.deepEqual([...tokenNames].filter(k => v1Names.has(k)), ["--gutter"]);
  assert.ok(styleRules.some(r => r.selector === ":root" && !r.media && r.decls.some(([k, v]) => k === "--gutter" && v === "16px")), "style.css の :root に --gutter: 16px（v1 の幅は変わらない）");
});

// ---------------------------------------------------------------- トークンの値とコントラスト
/** tokens.css の値を解く（mode: "light" | "dark"） */
function tokenValues(mode) {
  const vals = {};
  for (const r of tokenRules) {
    const dark = r.media && /prefers-color-scheme:\s*dark/.test(r.media);
    if (r.media && !dark) continue;
    if (dark && mode !== "dark") continue;
    for (const [k, v] of r.decls) vals[k] = v;
  }
  const resolve = (v, depth = 0) => {
    const m = /^var\((--[a-z0-9-]+)\)$/.exec(v);
    return m && depth < 10 ? resolve(vals[m[1]], depth + 1) : v;
  };
  return Object.fromEntries(Object.keys(vals).map(k => [k, resolve(vals[k])]));
}
const lum = (hex) => {
  const c = hex.replace("#", "").match(/../g).map(x => parseInt(x, 16) / 255).map(x => x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4);
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const contrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

const ROLES = ["bg", "surface", "surface-2", "text", "text-2", "muted", "primary", "primary-hover", "primary-soft", "on-primary", "accent", "accent-soft", "divider", "control-border",
  "error", "error-soft", "success", "success-soft", "warn", "warn-soft", "safety-bg", "data-a", "data-a-soft", "data-b", "data-b-soft", "focus"];

test("css/tokens.css：役割の色・文字・余白・角丸・影・動き・レイアウトの値がそろっている", () => {
  for (const mode of ["light", "dark"]) {
    const t = tokenValues(mode);
    for (const r of ROLES) assert.match(t[`--color-${r}`] ?? "", /^#[0-9A-Fa-f]{6}$/, `${mode} --color-${r}`);
  }
  const t = tokenValues("light");
  assert.deepEqual(["--fs-12", "--fs-14", "--fs-16", "--fs-18", "--fs-22", "--fs-28"].map(k => parseFloat(t[k]) * 16), [12, 14, 16, 18, 22, 28]);
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7].map(n => t[`--space-${n}`]), ["4px", "8px", "12px", "16px", "24px", "32px", "48px"]);
  assert.deepEqual(["sm", "md", "lg", "pill"].map(k => t[`--radius-${k}`]), ["8px", "12px", "16px", "999px"]);
  assert.equal(t["--lh-body"], "1.7"); assert.equal(t["--lh-head"], "1.4");
  assert.equal(t["--dur-fast"], "150ms"); assert.equal(t["--dur"], "250ms"); assert.equal(t["--ease"], "ease-out");
  assert.equal(t["--content-max"], "720px"); assert.equal(t["--gutter-mobile"], "16px"); assert.equal(t["--gutter-wide"], "24px"); assert.equal(t["--tap"], "44px");
  assert.ok(t["--shadow-float"]);
  assert.match(tokensCss, /prefers-reduced-motion:\s*reduce\)\s*\{\s*:root\s*\{\s*--dur-fast:\s*0ms;\s*--dur:\s*0ms;/, "動きを減らす設定では 0");
});

test("色：ui-audit.md §3.2 の値のまま（ライト・ダーク）", () => {
  const L = tokenValues("light"), D = tokenValues("dark");
  const spec = {
    bg: ["#F6F4F0", "#121319"], surface: ["#FFFFFF", "#1B1D25"], "surface-2": ["#EEEAE4", "#252833"], text: ["#1F2230", "#ECEDF2"], "text-2": ["#474C5E", "#C5C8D4"],
    muted: ["#5F6475", "#9EA2B2"], primary: ["#26304F", "#C9D3F5"], "on-primary": ["#FFFFFF", "#151A2E"], accent: ["#A8466F", "#E79BBA"], divider: ["#E3DED6", "#2E313C"],
    "control-border": ["#868A99", "#7D8295"], error: ["#B3261E", "#F28E84"], success: ["#2C7349", "#7FCC9E"], "safety-bg": ["#FBEDEE", "#3A2228"], "data-a": ["#2E5E8C", "#8AB2DE"], "data-b": ["#A3456F", "#E391B6"],
  };
  for (const [r, [l, d]] of Object.entries(spec)) {
    assert.equal(L[`--color-${r}`].toUpperCase(), l, `light ${r}`);
    assert.equal(D[`--color-${r}`].toUpperCase(), d, `dark ${r}`);
  }
});

test("コントラスト：文字は面・面2の上で 4.5:1 以上、部品の枠とフォーカスは背景・面の上で 3:1 以上", () => {
  for (const mode of ["light", "dark"]) {
    const t = tokenValues(mode), c = (k) => t[`--color-${k}`];
    for (const fg of ["text", "text-2", "muted", "accent", "error", "success", "warn", "data-a", "data-b"]) {
      for (const bg of ["bg", "surface", "surface-2"]) assert.ok(contrast(c(fg), c(bg)) >= 4.5, `${mode} ${fg} / ${bg} ${contrast(c(fg), c(bg)).toFixed(2)}`);
    }
    for (const [fg, bg] of [["on-primary", "primary"], ["on-primary", "primary-hover"], ["error", "error-soft"], ["success", "success-soft"], ["warn", "warn-soft"],
      ["accent", "accent-soft"], ["data-a", "data-a-soft"], ["data-b", "data-b-soft"], ["text", "safety-bg"], ["text-2", "safety-bg"], ["muted", "safety-bg"],
      ["text", "primary-soft"], ["text-2", "primary-soft"], ["muted", "primary-soft"]]) {
      assert.ok(contrast(c(fg), c(bg)) >= 4.5, `${mode} ${fg} / ${bg} ${contrast(c(fg), c(bg)).toFixed(2)}`);
    }
    for (const fg of ["control-border", "focus", "primary"]) for (const bg of ["bg", "surface"]) {
      assert.ok(contrast(c(fg), c(bg)) >= 3, `${mode} ${fg} / ${bg} ${contrast(c(fg), c(bg)).toFixed(2)}`);
    }
  }
});

test("style.css：開発・検証用（dev-only）は ?dev=1 のときだけ、user-only は ?dev=1 のとき隠す", () => {
  const hides = (sel) => styleRules.some(r => !r.media && r.selector === sel && r.decls.some(([k, v]) => k === "display" && /none\s*!important/.test(v)));
  assert.ok(hides(':root:not([data-dev="1"]) .dev-only'));
  assert.ok(hides(':root[data-dev="1"] .user-only'));
  assert.ok(styleRules.some(r => r.media && /pointer:\s*coarse/.test(r.media) && r.selector === ':root:not([data-dev="1"]) .kbd-hint'), "キーボードの説明は、細かく指せない端末の利用者向けでは隠す");
});

// ================================================================ アイコン
test("img/icons.svg：<symbol> が ICON_NAMES と同じで、線のアイコンの決まりを守る", () => {
  const svg = read("img/icons.svg");
  const symbols = [...svg.matchAll(/<symbol\b([^>]*)>([\s\S]*?)<\/symbol>/g)].map(m => ({ attrs: m[1], body: m[2], id: /id="([^"]+)"/.exec(m[1])?.[1] }));
  assert.deepEqual(symbols.map(s => s.id).sort(), [...ICON_NAMES].sort());
  assert.ok(ICON_NAMES.length >= 10);
  for (const s of symbols) {
    assert.match(s.attrs, /viewBox="0 0 24 24"/, s.id);
    assert.match(s.attrs, /fill="none"/, s.id);
    assert.match(s.attrs, /stroke="currentColor"/, s.id);
    assert.match(s.attrs, /stroke-width="1.5"/, s.id);
    assert.ok(!/fill="(?!none)|stroke="(?!currentColor)|stroke-width="(?!1.5)|style=/.test(s.body), `${s.id} の中で色・太さを変えていない`);
  }
  assert.ok(!/https?:\/\/(?!www\.w3\.org\/2000\/svg)/.test(svg), "外部の参照がない");
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
