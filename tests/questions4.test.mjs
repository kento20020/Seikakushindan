// node tests/questions4.test.mjs
// 24問版（v4。決定 U44「どっち？」の2択）の設問（js/data/questions4.js）。仕様：docs/diagnosis-v4.md §3
//  - 24個の ID（U・P・N が8つずつ）・固定の出題順・同じ領域を続けない
//  - どの領域にも U・P・N が1つずつ。どの問にも A と B の文、場面の問には場面の文
//  - P は仕様書の文のまま、U は仕様書の個別評定の2文の組
//  - 問いの1行（場面の文が「？」で終わる問は出さない）・保存値・「判断できない」・開始画面の文・版の印
import assert from "node:assert/strict";
import {
  ITEMS4, QUESTION_ORDER4, TOTAL4, ANSWER4, UNKNOWN_LABEL4, ASK_U4, ASK_SCENE4, KIND_LABEL4, START4, QUESTION_BANK_VERSION4, DIAGNOSIS_VERSION4,
  askOf4, idsOfDomain4,
} from "../js/data/questions4.js";

let fail = 0, pass = 0;
function test(name, fn) {
  try { fn(); pass++; console.log("OK   " + name); }
  catch (e) { fail++; console.log("FAIL " + name + "\n  " + (e.stack || e).toString().split("\n").slice(0, 6).join("\n  ")); }
}

const ORDER = ["U1", "P2", "N3", "U4", "P5", "N6", "U7", "P8", "N1", "U2", "P3", "N4", "U5", "P6", "N7", "U8",
  "P1", "N2", "U3", "P4", "N5", "U6", "P7", "N8"];

test("24個の ID（U・P・N が8つずつ）と、固定の出題順", () => {
  assert.equal(TOTAL4, 24);
  assert.deepEqual([...QUESTION_ORDER4], ORDER);
  assert.equal(new Set(QUESTION_ORDER4).size, 24);
  assert.deepEqual(Object.keys(ITEMS4).sort(), [...ORDER].sort());
  for (const k of ["U", "P", "N"]) assert.equal(QUESTION_ORDER4.filter((id) => ITEMS4[id].kind === k).length, 8, k);
});

test("同じ領域を続けて聞かない。U・P・N を混ぜる（同じ種類が3つ続かない）", () => {
  for (let i = 1; i < QUESTION_ORDER4.length; i++) {
    assert.notEqual(ITEMS4[QUESTION_ORDER4[i]].domain, ITEMS4[QUESTION_ORDER4[i - 1]].domain, `${QUESTION_ORDER4[i - 1]} → ${QUESTION_ORDER4[i]}`);
  }
  for (let i = 2; i < QUESTION_ORDER4.length; i++) {
    const k = QUESTION_ORDER4.slice(i - 2, i + 1).map((id) => ITEMS4[id].kind);
    assert.ok(!(k[0] === k[1] && k[1] === k[2]), `同じ種類が3つ続く：${QUESTION_ORDER4.slice(i - 2, i + 1)}`);
  }
});

test("どの領域にも U・P・N が1つずつ。どの問にも A と B の文（場面の問には場面の文）", () => {
  for (let d = 1; d <= 8; d++) {
    const ids = idsOfDomain4(d);
    assert.deepEqual(ids, { U: `U${d}`, P: `P${d}`, N: `N${d}` });
    for (const [k, id] of Object.entries(ids)) {
      const it = ITEMS4[id];
      assert.ok(it, id);
      assert.equal(it.kind, k);
      assert.equal(it.domain, d);
      assert.ok(it.a && it.b && it.a !== it.b, id);
      if (k === "U") assert.equal(it.scene, undefined);
      else assert.ok(typeof it.scene === "string" && it.scene.length > 10, id);
    }
  }
});

test("仕様書の文のとおり（P はそのまま、U は個別評定の2文の組。いくつかを抜き出して確かめる）", () => {
  assert.equal(ITEMS4.U1.a, "空気が悪くなっても、話が途中なら、その場で話し合いを続けることが多い。");
  assert.equal(ITEMS4.U1.b, "言い合いになったときは、一人になる時間を取ってから相手と話すことが多い。");
  assert.equal(ITEMS4.U8.b, "原因の整理が終わっていなくても、普段どおり話せる状態に戻ると一区切りついたと感じる。");
  assert.equal(ITEMS4.P5.scene, "相手から謝られましたが、まだ十分には納得できません。先に求めるのは？");
  assert.equal(ITEMS4.P8.a, "次に同じことが起きたときの対応が決まること。");
  assert.equal(ITEMS4.N1.b, "「少し時間をおこう」と送って、いったんやりとりを止める。");
  assert.equal(ITEMS4.N8.scene, "喧嘩のあと、相手が「もう気にしてないよ」と、普段どおりに話しかけてきました。");
});

test("問いの1行：U は「普段の自分に近いのは、どっち？」、場面は「この場面で、自分に近いのは、どっち？」。「？」で終わる場面（P1・P5・P8）は出さない", () => {
  assert.equal(ASK_U4, "普段の自分に近いのは、どっち？");
  assert.equal(ASK_SCENE4, "この場面で、自分に近いのは、どっち？");
  for (const id of QUESTION_ORDER4) {
    const it = ITEMS4[id];
    const want = it.kind === "U" ? ASK_U4 : ["P1", "P5", "P8"].includes(id) ? null : ASK_SCENE4;
    assert.equal(askOf4(it), want, id);
  }
  assert.equal(askOf4(null), null);
  assert.deepEqual({ ...KIND_LABEL4 }, { U: "普段の自分について", P: "場面", N: "場面" });
});

test("保存値（A＝1・B＝−1）・判断できない・開始画面の文（分数は入れない）・版の印", () => {
  assert.deepEqual({ ...ANSWER4 }, { A: 1, B: -1 });
  assert.equal(UNKNOWN_LABEL4, "判断できない（経験がない・思い浮かばない）");
  assert.equal(START4.title, "24問で、ふたりのすれ違い方を整理する");
  assert.equal(START4.lead, "普段の自分についての8問と、場面ごとの16問です。どの問も、2つの選択肢のうち自分に近い方を選びます。");
  assert.ok(START4.guide.startsWith("今の恋人との、最近の普段の自分を思い浮かべてください。"));
  for (const t of Object.values(START4)) assert.ok(!/分/.test(t.replace(/自分|部分|十分|気分/g, "")), `分数を入れない：${t}`);
  assert.equal(DIAGNOSIS_VERSION4, "v4");
  assert.equal(QUESTION_BANK_VERSION4, "v4-24-dotchi-2026-10-21");
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
