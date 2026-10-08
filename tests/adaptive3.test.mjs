// node tests/adaptive3.test.mjs
// 三択版の可変質問票（js/adaptive3.js）のテスト（仕様：docs/three-choice-logic.md §4〜5）
//  - 設問バンク（W 48組＋対決由来24、X 56組）と、対決設問の A/B の向き
//  - 段階の流れ：全部「左」の回答者、全領域を拮抗させた回答者（W追加 → X追加、上限内で最大96問）
//  - W追加は1問ごとに再集計して、優勢が決まった領域を打ち切る
//  - 問題を変える：候補の順番、1枠2回まで、使い切ったら（候補が尽きたら）答えずに進む
//  - 戻る、toJSON/fromJSON、固定64問
//  - 5択回答からの推定（石原・別宮・P1〜P5）が最後まで動き、選択を5択版と並べて表示する
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { createSession3, Session3, drive, fromLikertAnswers, fromScores, W_ITEMS, X_ITEMS, W_POOL, W_BASE, ITEM3,
  MAX_SWAPS, W_EXTRA_CAP, X_EXTRA_CAP, W_EXTRA_PER_DOMAIN, X_EXTRA_PER_TRAIT, STAGES3, isTied } from "../js/adaptive3.js";
import { DOMAINS, TRAITS, DOM_OF } from "../js/engine.js";
import { QUESTIONS3 } from "../js/data/questions3.js";
import { SAMPLES3, PROFILE_SAMPLES3, EXPECTED5, sampleKey } from "../js/data/samples3.js";

const expectedV2 = JSON.parse(readFileSync(new URL("./expected_v2.json", import.meta.url), "utf-8"));
let fail = 0, pass = 0;
function test(name, fn) {
  try { fn(); pass++; console.log("OK   " + name); }
  catch (e) { fail++; console.log("FAIL " + name + "\n  " + (e.stack || e).toString().split("\n").slice(0, 5).join("\n  ")); }
}
const sideOf = (c, trait) => c.question.left.trait === trait ? "left" : "right";
/** 回答関数で最後まで。聞いた段階の列を返す */
function runAll(s, f) { const seq = []; drive(s, c => { seq.push(c.stage); return f(c); }); return seq; }
const counts = (arr) => arr.reduce((o, x) => (o[x] = (o[x] || 0) + 1, o), {});

/** ラウンド1〜4の組をオイラー路で向き付けし、各傾向がちょうど2勝2敗になる勝者を作る（全 level 50） */
function evenWinners() {
  const adj = {}, winner = {};
  for (let r = 1; r <= 4; r++) QUESTIONS3.xRounds[r - 1].forEach((_, i) => {
    const q = X_ITEMS[`X${r}-${i + 1}`];
    (adj[q.left] ||= []).push({ id: q.id, to: q.right }); (adj[q.right] ||= []).push({ id: q.id, to: q.left });
  });
  for (const start of Object.keys(adj)) {
    const stack = [start];
    while (stack.length) {
      const v = stack[stack.length - 1];
      const e = adj[v].find(x => !winner[x.id]);
      if (e) { winner[e.id] = v; stack.push(e.to); } else stack.pop();
    }
  }
  return winner;
}

// ---------------------------------------------------------------- 1. 設問バンク
test("設問バンク：W 48組＋対決由来24（Q7x a/b・D?x）、X 7ラウンド×8組", () => {
  assert.equal(Object.values(W_ITEMS).filter(q => q.src === "base" || q.src === "alt").length, 48);
  assert.equal(Object.keys(W_ITEMS).length, 72);
  assert.equal(Object.keys(X_ITEMS).length, 56);
  for (const d of Object.keys(DOMAINS)) {
    assert.equal(W_BASE[d].length, 4);
    assert.deepEqual(W_POOL[d], [`W${d}-5`, `W${d}-6`, `Q${72 + +d}a`, `Q${72 + +d}b`, `D${d}x`]);
  }
  for (const q of Object.values(X_ITEMS)) assert.notEqual(DOM_OF[q.left], DOM_OF[q.right], `${q.id} は同じ領域どうし`);
});
test("対決由来の設問は領域の A行動／B行動に揃える（Q74 は sideA=熟考、D3x は sideA=待つ）", () => {
  assert.equal(W_ITEMS.Q74a.a, "その場で今の考えを返したい");       // 即応（A）
  assert.equal(W_ITEMS.Q74a.b, "一度考える時間を取ってから返したい"); // 熟考（B）
  assert.equal(W_ITEMS.D3x.a, "「大丈夫？」と一言送る");              // 追う（A）
  assert.equal(W_ITEMS.Q73a.a, "今の論点を整理して話を続けたい");     // 向き合う（A）＝sideA のまま
});

// ---------------------------------------------------------------- 2. 段階の流れ
test("W基本は領域を順繰りに、左右は各領域で半々（A行動がいつも左ではない）", () => {
  const s = createSession3();
  const steps = s.plan.s1;
  assert.deepEqual(steps.slice(0, 9).map(x => x.item), ["W1-1", "W2-1", "W3-1", "W4-1", "W5-1", "W6-1", "W7-1", "W8-1", "W1-2"]);
  for (const d of Object.keys(DOMAINS)) assert.equal(steps.filter(x => x.domain === +d && x.flip).length, 2, `領域${d}`);
  assert.deepEqual(steps.slice(0, 4).map(x => x.flip), [false, true, false, true]);
  const c = s.current();
  assert.equal(c.stage, "W基本"); assert.equal(c.kind, "W"); assert.equal(c.slot, "WB-1-1");
  assert.equal(c.question.left.trait, "向き合う"); assert.equal(c.total, 64);
});
test("採点は位置ではなく傾向：B行動が左の枠で「左」→ B側に数える", () => {
  const s = createSession3();
  s.answer("left");                     // WB-1-1（A が左）→ 向き合う
  assert.equal(s.current().question.left.trait, "熟考");
  s.answer("left");                     // WB-2-1（B が左）→ 熟考
  const r = s.result();
  assert.deepEqual(r.w[1], { a: 1, b: 0, n: 1 });
  assert.deepEqual(r.w[2], { a: 0, b: 1, n: 1 });
  assert.equal(r.records[1].picked, "熟考"); assert.equal(r.records[1].answer, "left"); assert.equal(r.records[1].flip, true);
});
test("全部「左」：W は各領域 3:3 で拮抗 → W追加16・X追加あり、最大96問、位置バイアスで品質NG", () => {
  const s = createSession3();
  const seq = runAll(s, () => "left");
  const r = s.result();
  assert.ok(seq.length <= 96);
  assert.equal(r.stages.wExtra.length, W_EXTRA_CAP);
  for (const d of Object.keys(DOMAINS)) assert.deepEqual(r.w[d], { a: 3, b: 3, n: 6 });
  assert.ok(r.stages.xExtra.length > 0 && r.stages.xExtra.length <= X_EXTRA_CAP);
  assert.equal(r.quality.leftRate, 1); assert.equal(r.quality.ok, false);
  assert.ok(r.select.chosen.length >= 2);
  // 段階は W基本 → X基本 → W追加 → X追加 の順
  const order = seq.map(x => STAGES3.indexOf(x));
  assert.ok(order.every((v, i) => i === 0 || order[i - 1] <= v), "段階が逆戻りしない");
});
test("全領域を拮抗させた回答者：W追加（領域あたり2）→ X追加（傾向あたり2）、合計96問ちょうど", () => {
  const win = evenWinners();
  const s = createSession3();
  const seq = runAll(s, c => {
    if (c.kind === "W") { const D = DOMAINS[c.domain]; return sideOf(c, c.n % 2 === 1 ? D.a : D.b); }   // a,b,a,b,a,b
    if (win[c.question.id]) return sideOf(c, win[c.question.id]);
    return "left";
  });
  const r = s.result();
  assert.deepEqual(counts(seq), { "W基本": 32, "X基本": 32, "W追加": 16, "X追加": 16 });
  assert.equal(seq.length, 96);
  assert.deepEqual(seq.slice(64, 80), Array(16).fill("W追加"));
  const perDomain = counts(r.stages.wExtra.map(x => x.domain));
  assert.ok(Object.values(perDomain).every(n => n <= W_EXTRA_PER_DOMAIN));
  const perTrait = {};
  for (const x of r.stages.xExtra) { const q = ITEM3[x.itemId]; perTrait[q.left] = (perTrait[q.left] || 0) + 1; perTrait[q.right] = (perTrait[q.right] || 0) + 1; }
  assert.ok(Object.values(perTrait).every(n => n <= X_EXTRA_PER_TRAIT), JSON.stringify(perTrait));
  assert.ok(r.stages.xExtra.every(x => [5, 6].includes(ITEM3[x.itemId].round)));
  // X基本が終わった時点では全傾向 50（m=4）だった：X追加の理由に level 50 が入る
  assert.ok(r.stages.xExtra.some(x => /level が 50（2\/4/.test(x.reason)), r.stages.xExtra[0].reason);
  assert.ok(Object.values(r.states).every(st => st.tie >= 0));
  assert.ok(r.select.chosen.some(h => h.meta.id === "S18"), "全領域拮抗なら S18");
});
test("W追加は1問ごとに再集計し、優勢が決まった領域は打ち切る（2:1＋スキップ → 追加1問で 3:1）", () => {
  const s = createSession3();
  let planned = null;
  while (!s.isDone()) {
    const c = s.current();
    if (c.kind === "W" && c.domain === 1) {
      if (c.slot === "WB-1-3") { s.answer(sideOf(c, "距離を取る")); continue; }
      if (c.slot === "WB-1-4") { if (c.canSwap) s.swap(); else s.skip(); continue; }
      if (c.stage === "W追加") { planned ??= s.plan.s3.map(x => x.key); s.answer(sideOf(c, "向き合う")); continue; }
      s.answer(sideOf(c, "向き合う")); continue;
    }
    if (c.kind === "W") { s.answer(sideOf(c, DOMAINS[c.domain].a)); continue; }   // ほかの領域は 4:0
    s.answer("right");
  }
  const r = s.result();
  assert.deepEqual(planned, ["WE-1-1", "WE-1-2"], "最初は領域1に2問を計画");
  assert.deepEqual(r.stages.wExtra.map(x => x.key), ["WE-1-1"], "1問目で 3:1 になったので2問目は出さない");
  assert.deepEqual(r.w[1], { a: 3, b: 1, n: 4 });
  assert.equal(r.stages.wExtra[0].itemId, "Q73a", "alt 2本は WB-1-4 の差し替えで使用済み → 対決の言い換えへ");
  assert.ok(s.log.some(e => e.type === "plan" && e.stage === 3 && e.keys.join() === "WE-1-1"));
  assert.equal(isTied(r.w[1]), false);
});

// ---------------------------------------------------------------- 3. 問題を変える・答えずに進む
test("問題を変える（W）：alt → Q7x a/b → D?x、1枠2回まで、候補が尽きたら答えずに進むだけ", () => {
  const s = createSession3();
  let c = s.current();
  assert.equal(c.swapsLeft, MAX_SWAPS); assert.equal(c.canSkip, false);
  assert.equal(s.skip(), false, "差し替えが残っているうちは答えずに進めない");
  s.swap(); c = s.current(); assert.equal(c.question.id, "W1-5"); assert.equal(c.swapsLeft, 1);
  s.swap(); c = s.current(); assert.equal(c.question.id, "W1-6"); assert.equal(c.swapsLeft, 0);
  assert.equal(c.canSwap, false); assert.equal(c.canSkip, true); assert.equal(s.swap(), false);
  assert.equal(s.skip(), true);
  while (s.current().slot !== "WB-1-2") s.answer("left");
  s.swap(); s.swap(); assert.equal(s.current().question.id, "Q73b"); s.skip();
  while (s.current().slot !== "WB-1-3") s.answer("left");
  s.swap(); c = s.current();
  assert.equal(c.question.id, "D1x"); assert.equal(c.swapsUsed, 1);
  assert.equal(c.canSwap, false, "領域1の候補を使い切った"); assert.equal(c.swapsLeft, 0); assert.equal(c.canSkip, true);
  s.answer("right");
  while (s.current().slot !== "WB-1-4") s.answer("left");
  c = s.current(); assert.equal(c.canSwap, false); assert.equal(c.canSkip, true, "最初から候補がない枠はすぐ答えずに進める");
  s.answer("left");
  const r = s.result();
  const rec = Object.fromEntries(r.records.map(x => [x.key, x]));
  assert.equal(rec["WB-1-1"].answer, null); assert.equal(rec["WB-1-1"].swaps, 2);
  assert.deepEqual(rec["WB-1-1"].shown, ["W1-1", "W1-5", "W1-6"]);
  assert.equal(rec["WB-1-3"].itemId, "D1x");
  assert.equal(r.w[1].n, 2, "差し替え前の設問と答えなかった枠は数えない");
  assert.equal(r.quality.skipCount, 2); assert.equal(r.quality.swapCount, 5);
  const hist = s.history();
  assert.deepEqual(hist["W1-1"].map(x => x.status), ["swapped"]);
  assert.deepEqual(hist["W1-6"].map(x => x.status), ["skipped"]);
});
test("問題を変える（X）：ラウンド7 → 未使用のラウンド5〜6（同じ傾向を含む組）。使った組は X追加 に出さない", () => {
  const s = createSession3();
  while (s.current().stage !== "X基本") s.answer("left");
  let c = s.current();
  assert.equal(c.question.id, "X1-1"); assert.deepEqual(c.traits, ["向き合う", "解決する"]);
  s.swap(); assert.equal(s.current().question.id, "X7-1");   // 向き合う vs 即応
  s.swap(); assert.equal(s.current().question.id, "X7-3");   // 解決する vs 追う
  s.answer("left");
  s.answer("left");                                           // X1-2
  c = s.current(); assert.equal(c.question.id, "X1-3");       // 広げる vs 即応：X7-1 は使用済み
  s.swap(); assert.equal(s.current().question.id, "X7-5");   // 広げる を含むラウンド7
  s.swap(); assert.equal(s.current().question.id, "X5-7");   // ラウンド7は尽きた → ラウンド5の 広げる
  s.answer("right");
  runAll(s, () => "left");
  const r = s.result();
  assert.ok(!r.stages.xExtra.some(x => x.itemId === "X5-7"));
  assert.equal(r.records.find(x => x.key === "XB-1-3").itemId, "X5-7");
});
test("回答済みの枠に戻って問題を変えると、その枠は未回答に戻る", () => {
  const s = createSession3();
  s.answer("left"); s.answer("right");
  s.back(); s.back();
  assert.equal(s.current().answer, "left");
  s.swap();
  assert.equal(s.current().answer, undefined);
  assert.equal(s.records().length, 1, "WB-2-1 だけが回答済み");
  s.answer("right");
  assert.equal(s.current().slot, "WB-3-1", "未回答の次の枠へ");
});

// ---------------------------------------------------------------- 4. 戻る・保存・固定
test("back：前の枠に戻って答え直せる（以前の回答は prev として記録）", () => {
  const s = createSession3();
  assert.equal(s.back(), false);
  s.answer("left"); s.answer("left");
  assert.equal(s.back(), true);
  let c = s.current();
  assert.equal(c.slot, "WB-2-1"); assert.equal(c.answer, "left");
  s.answer("right");
  c = s.current(); assert.equal(c.slot, "WB-3-1");
  assert.equal(s.log.filter(e => e.type === "answer").at(-1).prev, "left");
  assert.equal(s.records().find(r => r.key === "WB-2-1").picked, "即応");
});
test("toJSON / fromJSON：途中保存から再開して同じ結果", () => {
  const f = (c) => (c.index * 7 + c.question.id.length) % 3 === 0 ? "right" : "left";
  const a = createSession3();
  for (let i = 0; i < 40; i++) { if (i % 9 === 4) a.swap(); a.answer(f(a.current())); }
  a.swap();
  const b = Session3.fromJSON(JSON.parse(JSON.stringify(a.toJSON())));
  assert.equal(b.current().slot, a.current().slot);
  assert.equal(b.current().question.id, a.current().question.id);
  assert.equal(b.current().swapsLeft, a.current().swapsLeft);
  runAll(a, f); runAll(b, f);
  assert.deepEqual(b.result().levels, a.result().levels);
  assert.deepEqual(b.result().w, a.result().w);
  assert.deepEqual(b.result().select.chosen.map(h => h.meta.id), a.result().select.chosen.map(h => h.meta.id));
  assert.throws(() => Session3.fromJSON({ type: "seikaku16-session", version: 1 }));
});
test("adaptive=false：固定64問（W基本32＋X基本32）、全部拮抗でも追加なし", () => {
  const s = createSession3({ adaptive: false });
  const seq = runAll(s, c => c.kind === "W" ? sideOf(c, c.n % 2 ? DOMAINS[c.domain].a : DOMAINS[c.domain].b) : "left");
  assert.equal(seq.length, 64); assert.equal(s.steps().length, 64);
  const r = s.result();
  assert.equal(r.stages.wExtra.length, 0); assert.equal(r.stages.xExtra.length, 0);
  assert.deepEqual(s.progress().stages.map(x => x.label), ["W基本", "X基本"]);
});

// ---------------------------------------------------------------- 5. 5択回答からの推定
test("推定の規則：W基本は同じ番号の5択回答の大きい方、同点なら対決の向き、それも3なら差し替え→答えずに進む", () => {
  const base = {}; for (let i = 1; i <= 80; i++) base[i] = 3;
  // 領域2 k=1：即応 Q13 と 熟考 Q42 が同点 → Q74=1（sideA=熟考）→ 熟考
  const r1 = fromLikertAnswers({ ...base, 13: 4, 42: 4, 74: 1 }, 0, { adaptive: false }).result();
  const w21 = r1.records.find(x => x.key === "WB-2-1");
  assert.equal(w21.picked, "熟考"); assert.equal(w21.swaps, 0);
  // Q74=3 → 差し替え（W2-5）→ 対決の向きが無いので答えずに進む
  const r2 = fromLikertAnswers({ ...base, 13: 4, 42: 4 }, 0, { adaptive: false }).result();
  const w21b = r2.records.find(x => x.key === "WB-2-1");
  assert.equal(w21b.answer, null); assert.deepEqual(w21b.shown, ["W2-1", "W2-5"]);
  // 大きい方：即応 Q13=5、熟考 Q42=2 → 即応
  const r3 = fromLikertAnswers({ ...base, 13: 5, 42: 2 }, 0, { adaptive: false }).result();
  assert.equal(r3.records.find(x => x.key === "WB-2-1").picked, "即応");
  // X1-1（向き合う vs 解決する、行動文1）：Q4=5、Q1=2 → 向き合う。全部同点なら左
  const r4 = fromLikertAnswers({ ...base, 4: 5, 1: 2 }, 0, { adaptive: false }).result();
  assert.equal(r4.records.find(x => x.key === "XB-1-1").picked, "向き合う");
  assert.equal(r2.records.find(x => x.key === "XB-1-2").answer, "left");
});
test("EXPECTED5（埋め込み）は tests/expected_v2.json の選択と一致", () => {
  for (const c of expectedV2) assert.deepEqual(EXPECTED5[sampleKey(c.name)], c.expected.map(e => [e.id, e.role]), c.name);
});
const table = [];
for (const smp of SAMPLES3) {
  test(`${smp.label}：5択回答から三択の結果が最後まで出る`, () => {
    const s = fromLikertAnswers(smp.answers, smp.wording);
    assert.ok(s.isDone());
    const r = s.result();
    assert.ok(r.select.chosen.length >= 2 && r.select.chosen.length <= 4);
    assert.ok(r.records.length >= 64 && r.records.length <= 96);
    assert.ok(!r.select.hits.some(h => h.meta.id === "S16" || h.meta.id === "S17"));
    assert.equal(Object.keys(r.states).length, 8);
    assert.ok(Object.values(r.states).every(st => st.state !== null), "全領域に状態がつく");
    table.push([smp.label, r.select.chosen.map(h => `${h.meta.id}(${h.role})`), smp.expected5.map(([id, role]) => `${id}(${role})`),
      r.stages.wExtra.length, r.stages.xExtra.length]);
  });
}
for (const p of PROFILE_SAMPLES3) {
  test(`${p.key}：スコアから三択の結果が出る`, () => {
    const r = fromScores(p.scores, p.duel).result();
    assert.ok(r.select.chosen.length >= 2);
    table.push([p.label, r.select.chosen.map(h => `${h.meta.id}(${h.role})`), p.expected5.map(([id, role]) => `${id}(${role})`),
      r.stages.wExtra.length, r.stages.xExtra.length]);
  });
}

console.log("\n三択版の選択 vs 5択版の選択（tests/expected_v2.json）");
for (const [name, got, exp, we, xe] of table) {
  const gotIds = got.map(x => x.split("(")[0]), expIds = exp.map(x => x.split("(")[0]);
  const common = gotIds.filter(id => expIds.includes(id));
  console.log(`  ${name}\n    三択: ${got.join("  ")}   （W追加${we}・X追加${xe}）\n    5択 : ${exp.join("  ")}\n    共通: ${common.length ? common.join("・") : "なし"}`);
}
console.log(fail ? `\n${fail} failed, ${pass} passed` : `\nall ${pass} adaptive3 tests passed`);
process.exit(fail ? 1 : 0);
