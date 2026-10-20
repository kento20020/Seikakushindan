// node tests/app_swipe_dir.test.mjs
// 新しい画面（app/）の診断の、回答とスワイプの向きの対応（app/js/swipe_dir.js。docs/app-screens.md §4.3。決定 U41 の6）
//  - 上のカード（選択肢 "left"）は右へ・→ キー、下のカード（選択肢 "right"）は左へ・← キー。記録する答えは選択肢のまま
//  - つかんだカードだけが、その向きへだけ動く（逆向きは無効）。カードの外から始めたら、その向きで選ぶカードが動く。上・下はまとまりごと
//  - 今の画面（js/ui/swipe_variants.js の C）は前の向きのまま
import assert from "node:assert/strict";
import { DIR_OF, OPTION_OF, optionOfKey, movingPart, allows } from "../app/js/swipe_dir.js";
import { swipePart, swipeAllows } from "../js/ui/swipe_variants.js";

let fail = 0, pass = 0;
function test(name, fn) {
  try { fn(); pass++; console.log("OK   " + name); }
  catch (e) { fail++; console.log("FAIL " + name + "\n  " + (e.stack || e).toString().split("\n").slice(0, 6).join("\n  ")); }
}

test("上（left）は右へ、下（right）は左へ。向き → 選択肢は逆の対応", () => {
  assert.deepEqual({ ...DIR_OF }, { left: "right", right: "left" });
  assert.deepEqual({ ...OPTION_OF }, { right: "left", left: "right" });
  for (const opt of ["left", "right"]) assert.equal(OPTION_OF[DIR_OF[opt]], opt);
});

test("キー：→ は上（left）、← は下（right）、ほかは null", () => {
  assert.equal(optionOfKey("ArrowRight"), "left");
  assert.equal(optionOfKey("ArrowLeft"), "right");
  for (const k of ["ArrowUp", "ArrowDown", " ", "Enter", "a", undefined]) assert.equal(optionOfKey(k), null, String(k));
});

test("つかんだカードだけが、その向きへだけ動く", () => {
  // 上のカードをつかんだ：右へも左へも、動くのは上のカード（左へは無効＝抵抗だけ）
  assert.equal(movingPart({ axis: "x", dir: "right", startOption: "left" }), "left");
  assert.equal(movingPart({ axis: "x", dir: "left", startOption: "left" }), "left");
  assert.equal(allows("right", "left"), true);
  assert.equal(allows("left", "left"), false);
  // 下のカードをつかんだ：左へだけ
  assert.equal(movingPart({ axis: "x", dir: "left", startOption: "right" }), "right");
  assert.equal(allows("left", "right"), true);
  assert.equal(allows("right", "right"), false);
});

test("カードの外から始めたら、その向きで選ぶカードが動く。上・下はまとまりごと", () => {
  assert.equal(movingPart({ axis: "x", dir: "right", startOption: null }), "left");
  assert.equal(movingPart({ axis: "x", dir: "left", startOption: null }), "right");
  for (const startOption of [null, "left", "right"]) {
    assert.equal(movingPart({ axis: "y", dir: "up", startOption }), "card");
    assert.equal(movingPart({ axis: "y", dir: "down", startOption }), "card");
    assert.equal(allows("up", startOption), true);
    assert.equal(allows("down", startOption), true);
  }
  assert.equal(movingPart({}), "card");
  assert.equal(allows("right", null), true);
  assert.equal(allows("left", null), true);
});

test("今の画面の C は前の向きのまま（左の回答は左へ）", () => {
  assert.equal(swipePart("c", { axis: "x", dir: "left", startSide: "left" }), "left");
  assert.equal(swipeAllows("c", "left", "left"), true);
  assert.equal(swipeAllows("c", "right", "left"), false);
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
