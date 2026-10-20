// node tests/app_consult_examples.test.mjs
// 新しい画面（app/）の相談の入力の「例文を見る」（app/js/consult_examples.js。docs/app-screens.md §4.5。決定 U41 の2）
//  - 5件・id が重ならない・文は 120〜300字（入力の上限 MAX_CHARS 以下）・題は短い文
//  - どの例文も、規則の読み取り（js/consult/extract.js の readText）で安全の兆しが出ない（安全の確認の画面に進まない）
//  - 主な項目が読める（誰が最後か・相手の言葉・経過・気持ち・したいこと）。読み違えて最初の画面が変になる項目が無い
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CONSULT_EXAMPLES } from "../app/js/consult_examples.js";
import { readText } from "../js/consult/extract.js";

let fail = 0, pass = 0;
function test(name, fn) {
  try { fn(); pass++; console.log("OK   " + name); }
  catch (e) { fail++; console.log("FAIL " + name + "\n  " + (e.stack || e).toString().split("\n").slice(0, 6).join("\n  ")); }
}

// 入力の上限（app/js/consult.js は DOM を使うので読み込まず、定数の行を読む）
const MAX_CHARS = Number(readFileSync(new URL("../app/js/consult.js", import.meta.url), "utf8").match(/export const MAX_CHARS = (\d+);/)?.[1]);

/** 例文ごとに必ず読めてほしい項目（値）と、読めてはいけない項目（読み違えると最初の画面がずれるもの） */
const READ = {
  "P-ex1": { want: { lastSender: "self", partnerLast: "attack", elapsed: "lt3h", ongoing: false, goal: "reconcile" } },
  "P-ex2": { want: { lastSender: "partner", partnerLast: "attack", selfTemp: "high", intent: "tell" }, not: ["selfLast"] },   // 「言い返したい」を「言い返した」と読まない
  "P-ex3": { want: { intent: "apologize", cause: "self", repeat: false, elapsed: "3h_12h" }, not: ["lastSender"] },          // 会って言った言葉を「送った」と読まない
  "P-ex4": { want: { lastSender: "partner", elapsed: "lt3h" } },                                                          // 「先週から」ではなく「さっき」の返事
  "P-ex5": { want: { lastSender: "partner", elapsed: "lt3h" } },
};

test("5件・id が重ならない・並びは P-ex1〜P-ex5", () => {
  assert.equal(CONSULT_EXAMPLES.length, 5);
  assert.deepEqual(CONSULT_EXAMPLES.map(x => x.id), ["P-ex1", "P-ex2", "P-ex3", "P-ex4", "P-ex5"]);
  assert.equal(new Set(CONSULT_EXAMPLES.map(x => x.id)).size, 5);
});

test("文は 120〜300字で、入力の上限以下。題は短い文", () => {
  assert.ok(MAX_CHARS >= 300, `MAX_CHARS=${MAX_CHARS}`);
  for (const x of CONSULT_EXAMPLES) {
    const n = Array.from(x.text).length;
    assert.ok(n >= 120 && n <= 300, `${x.id}: ${n}字`);
    assert.ok(n <= MAX_CHARS, x.id);
    assert.equal(x.text, x.text.trim(), `${x.id}: 前後の空白`);
    if (x.label != null) assert.ok(typeof x.label === "string" && x.label.length > 0 && x.label.length <= 20, `${x.id}: 題`);
  }
});

for (const x of CONSULT_EXAMPLES) {
  test(`${x.id}「${x.label ?? ""}」：安全の兆しなし・主な項目が読める`, () => {
    const r = readText(x.text);
    assert.deepEqual(r.safety, { selfHarm: false, partnerThreat: false }, "安全の兆し");
    const spec = READ[x.id];
    assert.ok(spec, "確かめる項目の表に無い");
    for (const [k, v] of Object.entries(spec.want)) assert.equal(r.fields[k], v, `読めてほしい：${k}`);
    for (const k of spec.not ?? []) assert.equal(r.fields[k], undefined, `読めてはいけない：${k}`);
    console.log(`     読めた：${JSON.stringify(r.fields)}`);
  });
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
