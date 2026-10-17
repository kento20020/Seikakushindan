// node tests/swipe_variants.test.mjs
// 三択の質問カードの「スワイプの形」（?sw=card|a|b|c）のテスト。js/ui/swipe_variants.js（DOM を使わない純粋関数）
//  - swipePart：何を動かすか（カード全体／回答2枚の入れ物／左の回答／右の回答）を、全部の形・向き・指を置いた場所で
//  - swipeAllows：c で回答をつかんだときの逆向きだけ無効。ほかは常に有効
//  - 開発用の名前・説明・操作説明の文がそろっている。card の操作説明は今までと同じ文
//  - swipeHref：ほかのクエリ（ui・dev・qv・fb）を残して sw だけ差し替え、ハッシュは #three
//  - css/style.css：a・b・c の規則は .t3-qcard[data-sw…] の下だけ（card のときは効かない）。滑り込み・フェードの keyframes と、動きを減らす設定
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { swipePart, swipeAllows, swipeHref, normSwipe, SWIPE_LABEL, SWIPE_NAME, SWIPE_DESC, SWIPE_TIP } from "../js/ui/swipe_variants.js";
import { SWIPE_VARIANTS, DEFAULT_SWIPE } from "../js/ui_flags.js";

let fail = 0, pass = 0;
function test(name, fn) {
  try { fn(); pass++; console.log("OK   " + name); }
  catch (e) { fail++; console.log("FAIL " + name + "\n  " + (e.stack || e).toString().split("\n").slice(0, 6).join("\n  ")); }
}

const DIRS = [["x", "left"], ["x", "right"], ["y", "up"], ["y", "down"]];
const STARTS = ["left", "right", null];

// 期待値の表（形 → 指を置いた場所 → 向き → 動かすもの）
const EXPECT_PART = {
  card: { left: { left: "card", right: "card", up: "card", down: "card" }, right: { left: "card", right: "card", up: "card", down: "card" }, null: { left: "card", right: "card", up: "card", down: "card" } },
  a: { left: { left: "pair", right: "pair", up: "card", down: "card" }, right: { left: "pair", right: "pair", up: "card", down: "card" }, null: { left: "pair", right: "pair", up: "card", down: "card" } },
  b: { left: { left: "left", right: "right", up: "card", down: "card" }, right: { left: "left", right: "right", up: "card", down: "card" }, null: { left: "left", right: "right", up: "card", down: "card" } },
  c: { left: { left: "left", right: "left", up: "card", down: "card" }, right: { left: "right", right: "right", up: "card", down: "card" }, null: { left: "left", right: "right", up: "card", down: "card" } },
};
const EXPECT_ALLOW = {
  card: { left: { left: true, right: true, up: true, down: true }, right: { left: true, right: true, up: true, down: true }, null: { left: true, right: true, up: true, down: true } },
  a: { left: { left: true, right: true, up: true, down: true }, right: { left: true, right: true, up: true, down: true }, null: { left: true, right: true, up: true, down: true } },
  b: { left: { left: true, right: true, up: true, down: true }, right: { left: true, right: true, up: true, down: true }, null: { left: true, right: true, up: true, down: true } },
  c: { left: { left: true, right: false, up: true, down: true }, right: { left: false, right: true, up: true, down: true }, null: { left: true, right: true, up: true, down: true } },
};

// ================================================================ swipePart
test("swipePart：全部の形・向き・指を置いた場所で、動かすものが表のとおり", () => {
  for (const v of SWIPE_VARIANTS) for (const st of STARTS) for (const [axis, dir] of DIRS) {
    assert.equal(swipePart(v, { axis, dir, startSide: st }), EXPECT_PART[v][String(st)][dir], `${v} 始点 ${st} ${dir}`);
  }
});

test("swipePart：上・下はどの形でもカード全体。card はいつもカード全体", () => {
  for (const v of SWIPE_VARIANTS) for (const st of STARTS) for (const dir of ["up", "down"]) assert.equal(swipePart(v, { axis: "y", dir, startSide: st }), "card");
  for (const st of STARTS) for (const [axis, dir] of DIRS) assert.equal(swipePart("card", { axis, dir, startSide: st }), "card");
});

test("swipePart：b は指を置いた場所に関係なく向きの側。途中で向きが変われば動く回答も入れ替わる", () => {
  for (const st of STARTS) {
    assert.equal(swipePart("b", { axis: "x", dir: "left", startSide: st }), "left");
    assert.equal(swipePart("b", { axis: "x", dir: "right", startSide: st }), "right");
  }
});

test("swipePart：c はつかんだ回答だけ（逆向きでもその回答）。回答の外から始めたときは b と同じ", () => {
  for (const dir of ["left", "right"]) {
    assert.equal(swipePart("c", { axis: "x", dir, startSide: "left" }), "left");
    assert.equal(swipePart("c", { axis: "x", dir, startSide: "right" }), "right");
    assert.equal(swipePart("c", { axis: "x", dir, startSide: null }), swipePart("b", { axis: "x", dir, startSide: null }));
  }
  assert.equal(swipePart("c", { axis: "x", dir: "left", startSide: "middle" }), "left", "知らない始点は回答の外と同じ");
});

test("swipePart：知らない形は card、向きが分からないときはカード全体", () => {
  for (const v of ["", "d", "A", undefined, null, "pair"]) for (const [axis, dir] of DIRS) assert.equal(swipePart(v, { axis, dir, startSide: "left" }), "card", String(v));
  for (const v of SWIPE_VARIANTS) {
    assert.equal(swipePart(v, { axis: "x", dir: null, startSide: "left" }), "card");
    assert.equal(swipePart(v, {}), "card");
    assert.equal(swipePart(v), "card");
  }
});

// ================================================================ swipeAllows
test("swipeAllows：全部の形・向き・指を置いた場所で、表のとおり（c の逆向きだけ無効）", () => {
  for (const v of SWIPE_VARIANTS) for (const st of STARTS) for (const [, dir] of DIRS) {
    assert.equal(swipeAllows(v, dir, st), EXPECT_ALLOW[v][String(st)][dir], `${v} 始点 ${st} ${dir}`);
  }
  for (const v of ["", "d", undefined]) for (const st of STARTS) for (const [, dir] of DIRS) assert.equal(swipeAllows(v, dir, st), true, `知らない形 ${v}`);
});

test("swipeAllows と swipePart：c で無効な向きのときも、つかんだ回答が（抵抗つきで）動く", () => {
  for (const st of ["left", "right"]) {
    const other = st === "left" ? "right" : "left";
    assert.equal(swipeAllows("c", other, st), false);
    assert.equal(swipePart("c", { axis: "x", dir: other, startSide: st }), st);
  }
});

// ================================================================ 名前・説明・操作説明
test("名前・説明・操作説明の文が全部の形にそろっている。card の操作説明は今までと同じ文", () => {
  for (const v of SWIPE_VARIANTS) {
    for (const [name, table] of Object.entries({ SWIPE_LABEL, SWIPE_NAME, SWIPE_DESC, SWIPE_TIP })) assert.ok(typeof table[v] === "string" && table[v].length > 0, `${name}.${v}`);
    assert.match(SWIPE_TIP[v], /上へ＝$/, `${v} の操作説明は「上へ＝」で終わる（このあとに 問題を変える／答えずに進む が続く）`);
  }
  assert.deepEqual(Object.keys(SWIPE_LABEL), SWIPE_VARIANTS);
  assert.equal(SWIPE_TIP.card, "カードを左右にスワイプ（マウスならドラッグ）して答えられます。上へ＝");
  assert.equal(SWIPE_TIP.a, "回答を左右にスワイプ（マウスならドラッグ）して答えられます。上へ＝");
  assert.equal(SWIPE_TIP.b, "左を選ぶなら左へ、右を選ぶなら右へスワイプ（マウスならドラッグ）して答えられます。上へ＝");
  assert.equal(SWIPE_TIP.c, "選ぶ回答をつかんで、その側へスワイプ（左の回答は左へ、右の回答は右へ）して答えられます。上へ＝");
  assert.deepEqual(["a", "b", "c"].map(v => SWIPE_LABEL[v]), ["A", "B", "C"]);
});

test("normSwipe：card・a・b・c はそのまま、ほかは既定", () => {
  for (const v of SWIPE_VARIANTS) assert.equal(normSwipe(v), v);
  for (const v of ["", "B", "x", undefined, null, 1]) assert.equal(normSwipe(v), DEFAULT_SWIPE);
});

// ================================================================ swipeHref
test("swipeHref：ほかのクエリを残して sw だけ差し替え、ハッシュは #three", () => {
  assert.equal(swipeHref("a", ""), "./?sw=a#three");
  assert.equal(swipeHref("b", "?ui=v2&dev=1&qv=v1&fb=1"), "./?ui=v2&dev=1&qv=v1&fb=1&sw=b#three");
  assert.equal(swipeHref("card", "?dev=1&sw=c&ui=v2"), "./?dev=1&sw=card&ui=v2#three", "いまの sw は同じ位置で差し替える");
  assert.equal(swipeHref("c", "dev=1&sw=a&sw=b"), "./?dev=1&sw=c#three", "sw が2つあれば1つにまとめる");
  assert.equal(swipeHref("zz", "?dev=1"), "./?dev=1&sw=card#three", "知らない形は既定");
  assert.equal(swipeHref("a"), "./?sw=a#three");
  assert.equal(swipeHref("a", null), "./?sw=a#three");
});

// ================================================================ CSS
const css = readFileSync(new URL("../css/style.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

test("css/style.css：data-sw を使う規則は .t3-qcard[data-sw…] の下だけ（card のときはカードに data-sw が無いので効かない）", () => {
  const sels = [...css.matchAll(/([^{}]+)\{[^{}]*\}/g)].map(m => m[1].trim()).filter(s => /data-sw[\]=]/.test(s));   // data-swipe は除く
  assert.ok(sels.length >= 6, `規則が読めている（${sels.length}）`);
  for (const sel of sels) for (const one of sel.split(/,(?![^(]*\))/)) {
    if (!/data-sw[\]=]/.test(one)) continue;
    assert.match(one.trim(), /^\.t3-qcard(\[data-sw[^\]]*\]|:is\(\[data-sw="[abc]"\], \[data-sw="[abc]"\]\))/, one.trim());
  }
});

test("css/style.css：a・b・c の滑り込み・フェード・前面に出す・回転の中心・動きを減らす設定", () => {
  assert.match(css, /@keyframes t3-fade-in\s*\{/);
  assert.match(css, /@keyframes t3-rise-in\s*\{\s*from\s*\{\s*transform:\s*translateY\(8px\);\s*opacity:\s*0;/);
  assert.match(css, /\.t3-qcard\[data-sw\]:is\(\.t3-enter-left, \.t3-enter-right\)\s*\{\s*animation:\s*none;/, "左右の確定ではカード自身は滑らせない");
  assert.match(css, /\.t3-qcard\[data-sw\]:is\(\.t3-enter-left, \.t3-enter-right\) > :is\(\.notice, \.t3-kicker, \.t3-stem, \.t3-ask\)\s*\{\s*animation:\s*t3-fade-in \.18s/);
  assert.match(css, /\.t3-qcard\[data-sw="a"\]\.t3-enter-right > \.t3-pair\s*\{\s*animation:\s*t3-in-right \.22s/);
  assert.match(css, /\.t3-qcard\[data-sw="a"\]\.t3-enter-left > \.t3-pair\s*\{\s*animation:\s*t3-in-left \.22s/);
  assert.match(css, /\.t3-qcard:is\(\[data-sw="b"\], \[data-sw="c"\]\):is\(\.t3-enter-left, \.t3-enter-right\) > \.t3-pair\s*\{\s*animation:\s*t3-rise-in \.22s/);
  assert.match(css, /\.t3-qcard\[data-sw\] \.t3-moving\s*\{\s*position:\s*relative;\s*z-index:\s*2;/);
  assert.match(css, /\.t3-qcard\[data-sw\] \.t3-pair, \.t3-qcard\[data-sw\] \.t3-card\s*\{\s*transform-origin:\s*50% 85%;/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.t3-qcard\[data-sw\]\[class\*="t3-enter-"\] > \*\s*\{\s*animation:\s*none;/);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
