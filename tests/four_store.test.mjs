// node tests/four_store.test.mjs
// 24問版（v4。決定 U42・U44）の保存・再開（js/ui/four_store.js）。仕様：docs/diagnosis-v4.md §7
//  - 保存の形（schemaVersion・diagnosisVersion・questionBankVersion・questionOrder・answers・currentIndex・completed）。答えは A＝1・B＝−1
//  - 不正な保存値（NaN・0・2・文字列・形の違い）は未回答に戻す。判断できない（null）と未回答（キーなし）を分ける
//  - U42 の当てはまり度の版の保存（問の版の印が違う）は読まずに捨てる。三択の保存には触らない
//  - 戻って答えを変えたら、今の24問の答えから結果を作り直す。読み込み直しても同じ結果
//  - 壊れた保存でも動く（v4 の診断は無いことにする）。ほかの版の保存（三択 seikaku16:three:v1）は消さない
// Node には localStorage が無いので、useStorage4 で入れ物（Map）を渡す
import assert from "node:assert/strict";
import {
  store4, restore4, start4, answer4, back4, discard4, adopt4, sanitizeSession4, progress4, current4, emptySession4,
  useStorage4, STORAGE_KEY4, session4JSON,
} from "../js/ui/four_store.js";
import { QUESTION_ORDER4, ITEMS4 } from "../js/data/questions4.js";
import { computeResult4, valueOf, domainOf } from "../js/engine4.js";

let fail = 0, pass = 0;
function test(name, fn) {
  try { fn(); pass++; console.log("OK   " + name); }
  catch (e) { fail++; console.log("FAIL " + name + "\n  " + (e.stack || e).toString().split("\n").slice(0, 6).join("\n  ")); }
}

function memory(init = {}) {
  const m = new Map(Object.entries(init));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: (k) => { m.delete(k); }, _m: m };
}
const broken = { getItem() { throw new Error("no"); }, setItem() { throw new Error("no"); }, removeItem() { throw new Error("no"); } };
const saved = (s) => JSON.parse(s.getItem(STORAGE_KEY4));
const THREE_KEY = "seikaku16:three:v1";
const THREE_VALUE = JSON.stringify({ sub: "result", session: { marker: "三択の保存" } });

/** i 番目の問いの答え（A＝1・B＝−1 を交互に） */
const valueFor = (id, i) => (i % 2 ? -1 : 1);

test("start4：保存の形（24個の questionOrder・空の answers・currentIndex 0・completed false）", () => {
  const s = memory();
  useStorage4(s);
  restore4();
  assert.equal(store4.session, null);
  start4();
  const j = saved(s);
  assert.equal(j.schemaVersion, 1);
  assert.equal(j.diagnosisVersion, "v4");
  assert.equal(j.questionBankVersion, "v4-24-dotchi-2026-10-21");
  assert.deepEqual(j.questionOrder, [...QUESTION_ORDER4]);
  assert.deepEqual(j.answers, {});
  assert.equal(j.currentIndex, 0);
  assert.equal(j.completed, false);
  assert.equal(current4().item.id, "U1");
});

test("24回の操作で終わる（判断できない2つ・戻って変えた1つを含む）。答えるたびに保存し、結果は今の答えから作る", () => {
  const s = memory({ [THREE_KEY]: THREE_VALUE });
  useStorage4(s);
  start4();
  for (let i = 0; i < 5; i++) assert.ok(answer4(valueFor(QUESTION_ORDER4[i], i)));
  assert.equal(saved(s).currentIndex, 5);
  assert.equal(Object.keys(saved(s).answers).length, 5);
  // 戻って4問目（U4）を B → A に変える
  assert.ok(back4());
  assert.ok(back4());
  assert.equal(current4().item.id, "U4");
  assert.deepEqual(current4().answer, { status: "answered", value: -1 });
  assert.ok(answer4(1));
  assert.equal(current4().item.id, "P5");
  for (let i = 4; i < 24; i++) {
    const id = QUESTION_ORDER4[i];
    assert.equal(current4().item.id, id);
    assert.ok(answer4(id === "P3" || id === "U3" ? null : valueFor(id, i)));
  }
  assert.equal(store4.session.completed, true);
  assert.ok(store4.result);
  assert.equal(store4.result.domains[4].picks.U, "A", "変えた答えで作り直している");
  assert.equal(store4.result.domains[3].state, "incomplete");
  assert.deepEqual(store4.result.domains[3].missing, [{ id: "U3", status: "unknown" }, { id: "P3", status: "unknown" }]);
  assert.deepEqual(saved(s).answers.P3, { status: "unknown", value: null });
  assert.equal(saved(s).completed, true);
  assert.deepEqual(progress4(store4.session), { answered: 24, total: 24, index: 23, ratio: 1 });
  assert.equal(answer4(1), false, "終わったあとは答えない");
  assert.equal(s.getItem(THREE_KEY), THREE_VALUE, "三択の保存に触らない");
  // 読み込み直しても同じ結果
  const before = JSON.stringify(store4.result);
  useStorage4(s);
  restore4();
  assert.equal(JSON.stringify(store4.result), before);
  assert.deepEqual(store4.result, computeResult4(store4.session.answers));
});

test("途中で読み込み直すと、同じ問いから続く", () => {
  const s = memory();
  useStorage4(s);
  start4();
  for (let i = 0; i < 10; i++) answer4(valueFor(QUESTION_ORDER4[i], i));
  useStorage4(s);
  restore4();
  assert.equal(current4().item.id, QUESTION_ORDER4[10]);
  assert.equal(progress4(store4.session).answered, 10);
  assert.equal(store4.result, null);
});

test("answer4：1・−1・null 以外は受け取らない（0・2・−2・文字列・NaN・A の文字）", () => {
  useStorage4(memory());
  start4();
  for (const bad of [0, 2, -2, "1", "A", NaN, 0.5, undefined, {}, true]) assert.equal(answer4(bad), false, String(bad));
  assert.equal(current4().item.id, "U1");
  assert.equal(answer4(-1), true);
  assert.equal(answer4(null), true);
  assert.equal(answer4(1), true);
  assert.deepEqual(store4.session.answers, { U1: { status: "answered", value: -1 }, P2: { status: "unknown", value: null }, N3: { status: "answered", value: 1 } });
});

test("不正な保存値は未回答に戻す。判断できない（null）と未回答（キーなし）は分ける", () => {
  const raw = {
    ...emptySession4(),
    answers: {
      U1: { status: "answered", value: NaN },           // NaN（JSON では null になる）
      P2: { status: "answered", value: 2 },             // 範囲の外
      N3: { status: "answered", value: "1" },           // 文字列の数
      U4: { status: "answered", value: 0 },             // 0（どちらでもない答えは無い）
      P5: { status: "unknown", value: 1 },              // unknown に値
      N6: { status: "answered", value: -1 },            // 正しい
      U7: { status: "unknown", value: null },           // 判断できない
      P8: { status: "answered", value: 3 },             // 範囲の外（U42 の当てはまり度の値）
      N1: { status: "answered", value: 1 },             // 正しい
      U2: 1,                                            // 形が違う
      P3: { status: "skipped", value: 1 },              // 知らない status
      R1A: { status: "answered", value: 1 },            // 知らない ID（U42 の ID）
    },
    currentIndex: 12,
  };
  // オブジェクトのまま（NaN のまま）でも、JSON を通しても同じ
  for (const x of [raw, JSON.parse(JSON.stringify(raw))]) {
    const s = sanitizeSession4(x);
    assert.deepEqual(Object.keys(s.answers).sort(), ["N1", "N6", "U7"]);
    assert.equal(valueOf(s.answers, "U7"), null);
    assert.equal(valueOf(s.answers, "U1"), undefined);
    assert.equal(s.completed, false);
    assert.equal(s.currentIndex, 0, "最初の未回答より先へは進めない");
    assert.deepEqual(domainOf(s.answers, 7).missing, [{ id: "U7", status: "unknown" }, { id: "P7", status: "unanswered" }, { id: "N7", status: "unanswered" }]);
    assert.equal(domainOf(s.answers, 7).n, 0);
    assert.ok(!("R1A" in s.answers));
  }
});

test("保存の currentIndex・completed は答えから決め直す（壊れた値で問いを飛ばさない・終わったことにしない）", () => {
  const answers = Object.fromEntries(QUESTION_ORDER4.slice(0, 6).map((id) => [id, { status: "answered", value: 1 }]));
  assert.equal(sanitizeSession4({ ...emptySession4(), answers, currentIndex: 3 }).currentIndex, 3, "戻っていた位置はそのまま");
  for (const ci of [99, -1, "3", 2.5, null]) assert.equal(sanitizeSession4({ ...emptySession4(), answers, currentIndex: ci }).currentIndex, 6, String(ci));
  assert.equal(sanitizeSession4({ ...emptySession4(), answers, currentIndex: 20 }).currentIndex, 6);
  const lie = sanitizeSession4({ ...emptySession4(), answers, completed: true, currentIndex: 23 });
  assert.equal(lie.completed, false);
  assert.equal(lie.currentIndex, 6);
  // 24問そろっていれば completed（保存の completed が false でも）
  const full = Object.fromEntries(QUESTION_ORDER4.map((id) => [id, { status: "unknown", value: null }]));
  assert.equal(sanitizeSession4({ ...emptySession4(), answers: full, completed: false }).completed, true);
  // questionOrder はいつも固定の24個
  assert.deepEqual(sanitizeSession4({ ...emptySession4(), questionOrder: ["P8"] }).questionOrder, [...QUESTION_ORDER4]);
  assert.ok(ITEMS4[QUESTION_ORDER4[0]]);
});

test("版が違う・形が違う保存は読めない（null）", () => {
  assert.equal(sanitizeSession4(null), null);
  assert.equal(sanitizeSession4([]), null);
  assert.equal(sanitizeSession4({ ...emptySession4(), schemaVersion: 2 }), null);
  assert.equal(sanitizeSession4({ ...emptySession4(), diagnosisVersion: "v3" }), null);
  assert.equal(sanitizeSession4({ ...emptySession4(), questionBankVersion: "v4-24-2099-01-01" }), null);
  assert.equal(sanitizeSession4({ ...emptySession4(), questionBankVersion: "v4-24-2026-10-20" }), null, "U42 の当てはまり度の版");
  assert.ok(sanitizeSession4({ ...emptySession4(), answers: "x" }));
});

// U42 の当てはまり度の版で保存した物（公開していない試しの物）
const OLD_RATINGS = JSON.stringify({ schemaVersion: 1, diagnosisVersion: "v4", questionBankVersion: "v4-24-2026-10-20",
  questionOrder: ["R1A"], answers: { R1A: { status: "answered", value: 3 }, P1: { status: "answered", value: -2 } }, currentIndex: 2, completed: false });

test("壊れた保存（JSON でない・版が違う・U42 の当てはまり度の版）：v4 の診断は無いことにする。三択の保存は消さない", () => {
  for (const bad of ["{oops", JSON.stringify({ schemaVersion: 9 }), "null", "[]", OLD_RATINGS]) {
    const s = memory({ [STORAGE_KEY4]: bad, [THREE_KEY]: THREE_VALUE });
    useStorage4(s);
    restore4();
    assert.equal(store4.session, null, bad);
    assert.equal(store4.result, null);
    assert.equal(s.getItem(THREE_KEY), THREE_VALUE);
    start4();
    assert.equal(s.getItem(THREE_KEY), THREE_VALUE);
    discard4();
    assert.equal(s.getItem(STORAGE_KEY4), null);
    assert.equal(s.getItem(THREE_KEY), THREE_VALUE, "discard4 も三択に触らない");
  }
});

test("保存できない環境でも動く（覚えないだけ）", () => {
  useStorage4(broken);
  restore4();
  assert.equal(store4.session, null);
  start4();
  assert.ok(answer4(1));
  assert.equal(current4().index, 1);
});

test("最後の問いのあとに欠けがあれば（壊れた保存を読んだときだけ）、最初の未回答へ。追加の問いは出さない", () => {
  const answers = Object.fromEntries(QUESTION_ORDER4.filter((id) => id !== "N3" && id !== "N8")
    .map((id) => [id, { status: "answered", value: 1 }]));
  const s = memory({ [STORAGE_KEY4]: JSON.stringify({ ...emptySession4(), answers, currentIndex: 2 }) });
  useStorage4(s);
  restore4();
  assert.equal(current4().item.id, "N3");
  answer4(-1);
  assert.equal(current4().item.id, "U4", "次の問いへ（答えてある問いは前の答えが出る）");
  store4.session.currentIndex = 23;
  answer4(-1);
  assert.equal(store4.session.completed, true);
  assert.deepEqual(store4.result.domains[8].picks, { U: "A", P: "A", N: "B" });
  assert.equal(store4.result.domains[8].state, "leanA");
});

test("adopt4：移した診断に置き換える。読めなければ投げて、今の診断は変えない", () => {
  const s = memory();
  useStorage4(s);
  start4();
  answer4(1);
  const keep = session4JSON();
  assert.throws(() => adopt4({ schemaVersion: 1 }));
  assert.deepEqual(session4JSON(), keep);
  assert.throws(() => adopt4(JSON.parse(OLD_RATINGS)), "U42 の当てはまり度の版は移せない");
  const full = Object.fromEntries(QUESTION_ORDER4.map((id) => [id, { status: "answered", value: -1 }]));
  adopt4({ ...emptySession4(), answers: full });
  assert.equal(store4.session.completed, true);
  assert.equal(store4.result.domains[1].state, "strongB");
  assert.equal(saved(s).completed, true);
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
