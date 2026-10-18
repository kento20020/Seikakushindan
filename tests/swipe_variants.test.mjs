// node tests/swipe_variants.test.mjs
// 三択の質問カードの「スワイプの形」（?sw=card|a|b|c）のテスト。js/ui/swipe_variants.js（DOM を使わない純粋関数）
//  - swipePart：何を動かすか（カード全体／回答2枚の入れ物／左の回答／右の回答）の主な場合
//  - swipeAllows：c で回答をつかんだときの逆向きだけ無効。ほかは有効
import assert from "node:assert/strict";
import { swipePart, swipeAllows } from "../js/ui/swipe_variants.js";

let fail = 0, pass = 0;
function test(name, fn) {
  try { fn(); pass++; console.log("OK   " + name); }
  catch (e) { fail++; console.log("FAIL " + name + "\n  " + (e.stack || e).toString().split("\n").slice(0, 6).join("\n  ")); }
}
const x = (dir, startSide = null) => ({ axis: "x", dir, startSide });
const y = (dir, startSide = null) => ({ axis: "y", dir, startSide });

test("swipePart：card はいつもカード全体。上・下はどの形でもカード全体", () => {
  for (const d of ["left", "right"]) assert.equal(swipePart("card", x(d, "left")), "card");
  for (const v of ["card", "a", "b", "c"]) for (const d of ["up", "down"]) assert.equal(swipePart(v, y(d, "left")), "card", `${v} ${d}`);
});

test("swipePart：a は回答2枚の入れ物、b は向きの側の回答（指を置いた場所は関係ない）", () => {
  assert.equal(swipePart("a", x("left")), "pair");
  assert.equal(swipePart("a", x("right", "left")), "pair");
  assert.equal(swipePart("b", x("left", "right")), "left");
  assert.equal(swipePart("b", x("right", "left")), "right");
});

test("swipePart：c はつかんだ回答だけ（逆向きでもその回答）。回答の外から始めたときは b と同じ", () => {
  assert.equal(swipePart("c", x("left", "left")), "left");
  assert.equal(swipePart("c", x("right", "left")), "left");
  assert.equal(swipePart("c", x("left", "right")), "right");
  assert.equal(swipePart("c", x("left")), "left");
  assert.equal(swipePart("c", x("right")), "right");
});

test("swipePart：知らない形は既定（c）と同じ", () => {
  assert.equal(swipePart("zz", x("left", "right")), "right");
  assert.equal(swipePart(undefined, x("right")), "right");
  assert.equal(swipeAllows("zz", "right", "left"), false);
});

test("swipeAllows：c で回答をつかんだときの逆向きだけ無効", () => {
  assert.equal(swipeAllows("c", "right", "left"), false);
  assert.equal(swipeAllows("c", "left", "right"), false);
  assert.equal(swipeAllows("c", "left", "left"), true);
  assert.equal(swipeAllows("c", "right", null), true, "回答の外から始めたときは制限なし");
  assert.equal(swipeAllows("c", "up", "left"), true, "上・下は制限なし");
  for (const v of ["card", "a", "b"]) assert.equal(swipeAllows(v, "right", "left"), true, v);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
