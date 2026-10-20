// node tests/questions4.test.mjs
// 24問版（v4。決定 U42）の設問（js/data/questions4.js）。仕様：docs/diagnosis-v4.md §2〜§4（持ち主の仕様書（2026-10-20）§4・§5）
//  - 24個の ID・固定の出題順・同じ領域の A/B を続けて聞かない
//  - 全文があること（R は文、P は場面・A・B）。傾向の名前が 8領域の A/B（js/engine.js の DOMAINS）と同じ
//  - 5段階のラベル（R・P）・保存値・「判断できない」・共通の問い・開始画面の文
import assert from "node:assert/strict";
import { ITEMS4, QUESTION_ORDER4, TOTAL4, RATING_CHOICES4, PREF_CHOICES4, UNKNOWN_LABEL4, PAIR_QUESTION4, START4, QUESTION_BANK_VERSION4, DIAGNOSIS_VERSION4 } from "../js/data/questions4.js";
import { DOMAINS } from "../js/engine.js";

let fail = 0, pass = 0;
function test(name, fn) {
  try { fn(); pass++; console.log("OK   " + name); }
  catch (e) { fail++; console.log("FAIL " + name + "\n  " + (e.stack || e).toString().split("\n").slice(0, 6).join("\n  ")); }
}

const ORDER = ["R1A", "R2B", "R3A", "R4B", "R5A", "R6B", "R7A", "R8B", "P1", "P2", "P3", "P4", "P5", "P6", "P7", "P8",
  "R1B", "R2A", "R3B", "R4A", "R5B", "R6A", "R7B", "R8A"];

test("24個の ID（R が16・P が8）と、固定の出題順", () => {
  assert.equal(TOTAL4, 24);
  assert.deepEqual([...QUESTION_ORDER4], ORDER);
  assert.equal(new Set(QUESTION_ORDER4).size, 24);
  assert.deepEqual(Object.keys(ITEMS4).sort(), [...ORDER].sort());
  assert.equal(QUESTION_ORDER4.filter((id) => ITEMS4[id].kind === "R").length, 16);
  assert.equal(QUESTION_ORDER4.filter((id) => ITEMS4[id].kind === "P").length, 8);
});

test("同じ領域の A と B を続けて聞かない", () => {
  for (let i = 1; i < QUESTION_ORDER4.length; i++) {
    const x = ITEMS4[QUESTION_ORDER4[i - 1]], y = ITEMS4[QUESTION_ORDER4[i]];
    if (x.kind === "R" && y.kind === "R") assert.notEqual(x.domain, y.domain, `${x.id} → ${y.id}`);
  }
});

test("全文がある。R の傾向の名前は 8領域の A/B と同じ。各領域に R の A・B と P が1つずつ", () => {
  for (const id of ORDER) {
    const it = ITEMS4[id];
    assert.equal(it.id, id);
    assert.ok(it.domain >= 1 && it.domain <= 8);
    if (it.kind === "R") {
      assert.ok(typeof it.text === "string" && it.text.length > 10 && it.text.endsWith("。"), id);
      assert.equal(it.trait, it.side === "A" ? DOMAINS[it.domain].a : DOMAINS[it.domain].b, id);
      assert.equal(id, `R${it.domain}${it.side}`);
    } else {
      for (const k of ["scene", "a", "b"]) assert.ok(typeof it[k] === "string" && it[k].length > 5, `${id}.${k}`);
      assert.equal(id, `P${it.domain}`);
    }
  }
  for (let d = 1; d <= 8; d++) for (const id of [`R${d}A`, `R${d}B`, `P${d}`]) assert.ok(ITEMS4[id], id);
});

test("仕様書の文のとおり（いくつかを抜き出して確かめる）", () => {
  assert.equal(ITEMS4.R1A.text, "空気が悪くなっても、話が途中なら、その場で話し合いを続けることが多い。");
  assert.equal(ITEMS4.R8B.text, "原因の整理が終わっていなくても、普段どおり話せる状態に戻ると一区切りついたと感じる。");
  assert.equal(ITEMS4.P3.scene, "喧嘩のあと、相手の連絡がいつもより少なく、少し不安です。");
  assert.equal(ITEMS4.P3.a, "自分から一度、相手の様子を確かめる。");
  assert.equal(ITEMS4.P8.b, "普段どおりに会話できる状態に戻ること。");
});

test("5段階のラベルと保存値・判断できない・共通の問い", () => {
  assert.deepEqual(RATING_CHOICES4.map((x) => [x.value, x.label]), [
    [0, "まったく当てはまらない"], [1, "あまり当てはまらない"], [2, "ある程度当てはまる"], [3, "かなり当てはまる"], [4, "とても当てはまる"]]);
  assert.deepEqual(PREF_CHOICES4.map((x) => [x.value, x.label]), [
    [2, "Aにかなり近い"], [1, "Aにやや近い"], [0, "どちらも同じくらい"], [-1, "Bにやや近い"], [-2, "Bにかなり近い"]]);
  assert.equal(UNKNOWN_LABEL4, "判断できない（経験がない・思い浮かばない）");
  assert.equal(PAIR_QUESTION4, "この場面では、どちらが自分に近いですか？");
});

test("開始画面の文（分数は入れない）と版の名前", () => {
  assert.equal(START4.title, "24問で、ふたりのすれ違い方を整理する");
  assert.equal(START4.lead, "普段の自分への16問と、場面ごとの8問です");
  assert.ok(START4.guide.startsWith("今の恋人との、最近の普段の自分を思い浮かべてください。"));
  assert.ok(START4.guide.endsWith("途中で思い浮かべる相手を変えないでください。"));
  for (const t of Object.values(START4)) assert.ok(!/[0-9０-９〜]+分|64|80/.test(t), t);
  assert.equal(DIAGNOSIS_VERSION4, "v4");
  assert.equal(QUESTION_BANK_VERSION4, "v4-24-2026-10-20");
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
