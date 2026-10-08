// node tests/engine3.test.mjs
// 三択版の判定エンジン（js/engine3.js）のテスト。手計算した値と比べる（仕様：docs/three-choice-logic.md §3）
//  - wMargin / tieMargin / domMargin3 の値
//  - 7状態（4:0→1、2:2で両方75→5、3:1で50/25→1w、2:2で50/50→7 など）
//  - S16・S17 は常に不成立（余裕−1・理由つき）、S18 は5領域以上の拮抗で成立
//  - select3 は engine.js の select を評価関数だけ差し替えて使う（5択版の select の既定動作は変わらない）
import assert from "node:assert/strict";
import { TH3, wMargin, tieMargin, domMargin3, basicMargin3, domainStates3, evaluateAll3, select3, patternMargin3,
  describeCondition3, responseQuality3, META3, META3_BY_ID, SHAPE_NOT_JUDGED, mid3 } from "../js/engine3.js";
import { select, evaluateAll, DOMAINS, TRAITS } from "../js/engine.js";
import { PATTERN_META } from "../js/data/patterns_meta.js";

let fail = 0, pass = 0;
function test(name, fn) {
  try { fn(); pass++; console.log("OK   " + name); }
  catch (e) { fail++; console.log("FAIL " + name + "\n  " + (e.stack || e).toString().split("\n").slice(0, 4).join("\n  ")); }
}
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg ?? ""} ${a} ≠ ${b}`);

/** プロファイルを作る。既定は全傾向50・全領域2:2（拮抗）。w は {d:[a,b]}、levels は {傾向: 値} */
function P({ w = {}, levels = {}, defW = [2, 2], defL = 50 } = {}) {
  const p = { levels: {}, w: {}, quality: { ok: true } };
  for (const t of TRAITS) p.levels[t] = levels[t] ?? defL;
  for (const d of Object.keys(DOMAINS)) { const [a, b] = w[d] ?? defW; p.w[d] = { a, b, n: a + b }; }
  return p;
}
const A1 = DOMAINS[1].a, B1 = DOMAINS[1].b;   // 向き合う／距離を取る

// ---------------------------------------------------------------- 1. 優勢・拮抗の余裕
test("TH3 は仕様どおり", () => {
  assert.deepEqual(TH3, { high: 67, low: 39, domShare: 0.6, domDiff: 2, levelFloor: 37.5, tieScale: 12.5 });
});

test("wMargin：3:1→18.75、4:0→50、4:2→8.33、5:1→29.17、2:2→−25、3:2→−12.5、n<2→−100", () => {
  const cases = [[[3, 1], 18.75], [[4, 0], 50], [[4, 2], 25 / 3], [[5, 1], 175 / 6], [[2, 2], -25], [[3, 2], -12.5], [[1, 0], -100], [[0, 0], -100]];
  for (const [[a, b], exp] of cases) near(wMargin(P({ w: { 1: [a, b] } }), 1, A1), exp, `${a}:${b}`);
  near(wMargin(P({ w: { 1: [1, 3] } }), 1, B1), 18.75, "B側 3:1");
  near(wMargin(P({ w: { 1: [1, 3] } }), 1, A1), -50, "劣勢側 1:3（取り分0.25→−43.75、差−2→−50 の小さい方）");
});

test("tieMargin：2:2→25、3:2→12.5、3:1→−18.75、4:0→−50", () => {
  near(tieMargin(P({ w: { 1: [2, 2] } }), 1), 25);
  near(tieMargin(P({ w: { 1: [3, 2] } }), 1), 12.5);
  near(tieMargin(P({ w: { 1: [3, 1] } }), 1), -18.75);
  near(tieMargin(P({ w: { 1: [0, 4] } }), 1), -50);
});

test("domMargin3 = min(wMargin, level − 37.5)", () => {
  near(domMargin3(P({ w: { 1: [3, 1] }, levels: { [A1]: 50 } }), A1), 12.5);
  near(domMargin3(P({ w: { 1: [4, 0] }, levels: { [A1]: 100 } }), A1), 50);
  near(domMargin3(P({ w: { 1: [4, 0] }, levels: { [A1]: 25 } }), A1), -12.5, "優勢でも level が低い");
  near(domMargin3(P({ w: { 1: [2, 2] }, levels: { [A1]: 100 } }), A1), -25, "拮抗");
});

// ---------------------------------------------------------------- 2. 7状態
function stateOf(w, LA, LB) {
  const st = domainStates3(P({ w: { 1: w }, levels: { [A1]: LA, [B1]: LB } }))[1];
  return st;
}
test("4:0、level 75/25 → 状態1（余裕 min(50, 8, 15) = 8）", () => {
  const st = stateOf([4, 0], 75, 25);
  assert.equal(st.state, "1"); near(st.margin, 8);
  assert.ok(st.margins["2"] < 0 && st.margins["1w"] < 0 && st.margins["5"] < 0);
});
test("2:2、level 75/75 → 状態5（両方強い、余裕8）", () => {
  const st = stateOf([2, 2], 75, 75);
  assert.equal(st.state, "5"); near(st.margin, 8);
  assert.ok(st.margins["7"] < 0, "両方強いなら7ではない");
});
test("3:1、level 50/25 → 1w（余裕 min(18.75, 16) = 16）、クロスの優勢は成立（12.5）", () => {
  const p = P({ w: { 1: [3, 1] }, levels: { [A1]: 50, [B1]: 25 } });
  const st = domainStates3(p)[1];
  assert.equal(st.state, "1w"); near(st.margin, 16);
  assert.equal(st.lead, A1);
  assert.ok(domMargin3(p, A1) >= 0); near(domMargin3(p, A1), 12.5);
});
test("2:2、level 50/50 → 状態7（余裕 min(25, 17, 10, 10) = 10）", () => {
  const st = stateOf([2, 2], 50, 50);
  assert.equal(st.state, "7"); near(st.margin, 10);
});
test("ほかの状態：0:4 25/75→3、2:2 25/25→6、3:1 75/50→2、1:3 50/75→4、1:3 25/50→3w", () => {
  assert.equal(stateOf([0, 4], 25, 75).state, "3");
  const s6 = stateOf([2, 2], 25, 25); assert.equal(s6.state, "6"); near(s6.margin, 15);
  const s2 = stateOf([3, 1], 75, 50); assert.equal(s2.state, "2"); near(s2.margin, 8);
  assert.equal(stateOf([1, 3], 50, 75).state, "4");
  assert.equal(stateOf([1, 3], 25, 50).state, "3w");
});
test("6分の1刻みの 66.7（4/6）は『中』の境目として扱う（どの状態にも入らない隙間を作らない）", () => {
  const st = stateOf([3, 1], 200 / 3, 25);
  assert.equal(st.state, "1w"); near(st.margin, 0);
  near(mid3(200 / 3), 0);
  near(mid3(50), 10); near(mid3(75), -9);   // 4問刻みでは仕様の式 min(L−40, 66−L) と同じ
  assert.ok(basicMargin3(P({ w: { 1: [3, 1] }, levels: { [A1]: 200 / 3 } }), 1, "1") < 0, "66.7 は高（≥67）ではない");
});
test("domainStates3：要確認（左右で優勢な側の level が対側より低い）", () => {
  const st = stateOf([3, 1], 25, 75);
  assert.equal(st.lead, A1); assert.equal(st.check, true);
  assert.equal(stateOf([3, 1], 75, 25).check, false);
});

// ---------------------------------------------------------------- 3. クロス・特殊・形状
test("クロス X12-1（優勢:向き合う × 優勢:即応）：両方 3:1 かつ level≥37.5 で成立、level 25 なら不成立", () => {
  const meta = META3_BY_ID["X12-1"];
  const ok = P({ w: { 1: [3, 1], 2: [4, 0] }, levels: { 向き合う: 50, 即応: 75 } });
  near(patternMargin3(meta, ok), 12.5);
  assert.ok(evaluateAll3(ok).some(h => h.meta.id === "X12-1"));
  const ng = P({ w: { 1: [3, 1], 2: [4, 0] }, levels: { 向き合う: 25, 即応: 75 } });
  assert.ok(patternMargin3(meta, ng) < 0);
});
test("特殊B S07（高:主導する・高:待つ）：高 かつ 対の傾向以上", () => {
  const meta = META3_BY_ID.S07;
  near(patternMargin3(meta, P({ levels: { 主導する: 75, 調整する: 50, 待つ: 100, 追う: 25 } })), 8);
  assert.ok(patternMargin3(meta, P({ levels: { 主導する: 75, 調整する: 100, 待つ: 100 } })) < 0, "対の調整するの方が高い");
});
test("特殊C S13：高4つ かつ 両領域とも左右が拮抗", () => {
  const meta = META3_BY_ID.S13;
  const hi = { 向き合う: 75, 距離を取る: 75, 追う: 75, 待つ: 75 };
  near(patternMargin3(meta, P({ levels: hi })), 8);
  assert.ok(patternMargin3(meta, P({ levels: hi, w: { 3: [3, 1] } })) < 0, "領域3が優勢なら不成立");
});
test("S16・S17 は三択版では常に不成立（余裕−1、理由つき）", () => {
  for (const L of [0, 25, 50, 75, 100]) {
    const p = P({ defL: L, defW: [4, 0] });
    const hits = evaluateAll3(p);
    assert.ok(!hits.some(h => h.meta.id === "S16" || h.meta.id === "S17"), `level ${L}`);
    for (const id of ["S16", "S17"]) {
      const details = [];
      assert.equal(patternMargin3(META3_BY_ID[id], p, details), -1);
      assert.equal(details[0].label, SHAPE_NOT_JUDGED);
    }
  }
});
test("S18：拮抗した領域が5以上で成立（余裕＝数−5、尺度2）", () => {
  const w5 = { 1: [2, 2], 2: [3, 2], 3: [2, 2], 4: [2, 2], 5: [2, 2], 6: [4, 0], 7: [0, 4], 8: [3, 1] };
  const h5 = evaluateAll3(P({ w: w5 })).find(h => h.meta.id === "S18");
  assert.ok(h5, "5領域で成立"); near(h5.margin, 0); near(h5.score, 5 * 0.4);
  const w4 = { ...w5, 5: [4, 0] };
  assert.ok(!evaluateAll3(P({ w: w4 })).some(h => h.meta.id === "S18"), "4領域では不成立");
  const h8 = evaluateAll3(P()).find(h => h.meta.id === "S18");
  near(h8.margin, 3); near(h8.sat, 1); near(h8.score, 5);
  assert.equal(META3_BY_ID.S18.scale, 2);
  assert.equal(PATTERN_META.find(m => m.id === "S18").scale, 4, "5択版のメタは書き換えない");
});
test("S19（全領域でA側が優勢）：全領域 3:1・level 50 で成立", () => {
  const p = P({ defW: [3, 1], levels: Object.fromEntries(Object.values(DOMAINS).map(D => [D.a, 50])) });
  const h = evaluateAll3(p).find(x => x.meta.id === "S19");
  assert.ok(h); near(h.margin, 12.5);
});

// ---------------------------------------------------------------- 4. 選択・品質・説明
test("select3：engine.js の select に evaluate を渡して使う（主軸1＋補強・矛盾、2〜4本）", () => {
  const p = P({ w: { 1: [4, 0], 2: [4, 0], 3: [0, 4], 4: [3, 1], 5: [2, 2], 6: [4, 0], 7: [1, 3], 8: [4, 0] },
    levels: { 向き合う: 100, 距離を取る: 0, 即応: 75, 熟考: 25, 追う: 25, 待つ: 75, 表に出す: 75, 内に置く: 50, 主導する: 75, 調整する: 25, 解決する: 100, 関係を戻す: 0 } });
  const r = select3(p);
  assert.ok(r.chosen.length >= 2 && r.chosen.length <= 4);
  assert.equal(r.chosen.filter(h => h.role === "主軸").length, 1);
  assert.deepEqual(r.hits.map(h => h.meta.id), evaluateAll3(p).map(h => h.meta.id));
  assert.deepEqual(select(p, { evaluate: evaluateAll3 }).chosen.map(h => h.meta.id), r.chosen.map(h => h.meta.id));
});
test("select の opts.evaluate は省略時 evaluateAll（5択版の動作は不変）", () => {
  const prof = { scores: Object.fromEntries(TRAITS.map((t, i) => [t, (i * 37) % 101])), duel: {}, qualityOk: true };
  assert.deepEqual(select(prof).chosen.map(h => h.meta.id), select(prof, { evaluate: evaluateAll }).chosen.map(h => h.meta.id));
  assert.deepEqual(select(prof, { evaluate: () => [] }).chosen, []);
});
test("responseQuality3：左の割合が0.85以上／0.15以下なら位置バイアス", () => {
  const rec = (l, r, s = 0) => [...Array(l).fill({ answer: "left", swaps: 1 }), ...Array(r).fill({ answer: "right" }), ...Array(s).fill({ answer: null })];
  assert.equal(responseQuality3(rec(17, 3)).ok, false);
  assert.equal(responseQuality3(rec(3, 17)).ok, false);
  assert.equal(responseQuality3(rec(16, 4)).ok, true);
  const q = responseQuality3(rec(10, 10, 2));
  assert.equal(q.ok, true); near(q.leftRate, 0.5); assert.equal(q.skipCount, 2); assert.equal(q.swapCount, 10);
  assert.equal(responseQuality3([]).ok, true);
});
test("describeCondition3：172本すべてに説明があり、形状は三択版の条件", () => {
  for (const m of META3) assert.ok(describeCondition3(m).length > 4, m.id);
  assert.match(describeCondition3(META3_BY_ID.S16), /判定しない/);
  assert.match(describeCondition3(META3_BY_ID.S18), /5領域以上/);
  assert.match(describeCondition3(META3_BY_ID["B1-1"]), /左右で向き合うが優勢/);
});

console.log(fail ? `\n${fail} failed, ${pass} passed` : `\nall ${pass} engine3 tests passed`);
process.exit(fail ? 1 : 0);
