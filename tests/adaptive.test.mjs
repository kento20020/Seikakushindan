// node tests/adaptive.test.mjs
// 可変質問票（js/adaptive.js）のテスト。
//  - 実回答サンプル（石原・別宮）が tests/expected_v2.json の16スコア・対決・選択を再現する
//  - 全部「3」の回答者には追加質問（1傾向2問まで・全体16問まで）と追加対決が入る
//  - 「別の言い方で聞く」で表現の番号が記録される
//  - adaptive=false は固定80問
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { createSession, Session, scoreFromAnswerMap, sessionFromAnswerMap, BASIC_BY_TRAIT, ITEM_BY_ID,
  FOLLOWUP_CAP, FOLLOWUP_MAX_PER_TRAIT } from "../js/adaptive.js";
import { TRAITS, DOMAINS } from "../js/engine.js";
import { SAMPLES } from "../js/data/samples.js";

const expected = JSON.parse(readFileSync(new URL("./expected_v2.json", import.meta.url), "utf-8"));
let fail = 0, pass = 0;
function test(name, fn) {
  try { fn(); pass++; console.log("OK   " + name); }
  catch (e) { fail++; console.log("FAIL " + name + "\n  " + (e.stack || e).toString().split("\n").slice(0, 4).join("\n  ")); }
}
/** 回答関数 f(current) で最後まで答える。聞いた設問の数を返す */
function runAll(s, f) { let n = 0; while (!s.isDone()) { s.answer(f(s.current())); n++; if (n > 500) throw new Error("loop"); } return n; }

// ---------------------------------------------------------------- 1. 実回答サンプル
for (const [i, name] of [[0, "石原"], [1, "別宮"]]) {
  const exp = expected.find(c => c.name === name);
  const sample = SAMPLES[i];
  test(`${name}: 80問シート → 16スコアが expected_v2 と一致（±0.6）`, () => {
    const r = scoreFromAnswerMap(sample.answers, sample.wording);
    for (const t of TRAITS) assert.ok(Math.abs(r.scores[t] - exp.scores[t]) <= 0.6, `${t}: ${r.scores[t]} vs ${exp.scores[t]}`);
  });
  test(`${name}: 対決の向きと強さが一致`, () => {
    const r = scoreFromAnswerMap(sample.answers, sample.wording);
    for (const [d, [side, strength]] of Object.entries(exp.duel)) {
      assert.equal(r.profile.duel[d].side, side, `domain ${d}`);
      assert.equal(r.profile.duel[d].strength, strength, `domain ${d}`);
    }
  });
  test(`${name}: 選択（id・役割）が expected_v2 と一致`, () => {
    const r = scoreFromAnswerMap(sample.answers, sample.wording);
    assert.deepEqual(r.select.chosen.map(h => [h.meta.id, h.role]), exp.expected.map(e => [e.id, e.role]));
    assert.equal(r.select.hits.length, exp.hits);
    assert.equal(r.quality.ok, exp.quality_ok);
  });
  test(`${name}: 固定80問セッションに流し込んでも同じ結果`, () => {
    const s = sessionFromAnswerMap(sample.answers, sample.wording);
    assert.equal(s.steps().length, 80);
    const r = s.result();
    assert.deepEqual(r.scores, scoreFromAnswerMap(sample.answers, sample.wording).scores);
    assert.deepEqual(r.select.chosen.map(h => h.meta.id), exp.expected.map(e => e.id));
    assert.ok(s.records().filter(x => ITEM_BY_ID[x.itemId].role === "basic").every(x => x.wordingIndex === sample.wording));
  });
}

// ---------------------------------------------------------------- 2. 全部「3」の回答者
test("全部3：追加質問は全体16問・1傾向2問まで、追加対決は8領域すべて", () => {
  const s = createSession();
  const n = runAll(s, () => 3);
  const r = s.result();
  const fu = r.stages.followups;
  assert.equal(fu.length, FOLLOWUP_CAP);
  const perTrait = {};
  for (const f of fu) perTrait[f.trait] = (perTrait[f.trait] || 0) + 1;
  assert.ok(Object.values(perTrait).every(c => c <= FOLLOWUP_MAX_PER_TRAIT), JSON.stringify(perTrait));
  assert.equal(Object.keys(perTrait).length, 16, "上限16問を16傾向に1問ずつ配る");
  // 追加質問は「まだ見せていない表現」（開始は表現A=0 なので 1）
  assert.ok(fu.every(f => f.wordingIndex === 1));
  assert.ok(!fu.some(f => f.itemId === "Q48"));
  assert.equal(r.stages.extraDuels.length, 8);
  assert.equal(n, 72 + 16 + 8 + 8);
  assert.equal(r.quality.ok, false, "全部3は回答品質NG");
});

test("1傾向だけ3：その傾向に追加2問（上限）、ほかは追加なし", () => {
  const target = "追う";
  const ids = new Set(BASIC_BY_TRAIT[target].map(i => i.id));
  const s = createSession();
  let firstFollowup = true;
  runAll(s, c => {
    if (c.stage === 2) { const v = firstFollowup ? 5 : 3; firstFollowup = false; return v; }  // 1問目ははっきり、2問目はまた3
    if (c.kind === "duel") return 1;
    return ids.has(c.item.id) ? 3 : 5;
  });
  const r = s.result();
  assert.equal(r.stages.followups.length, 2);
  assert.ok(r.stages.followups.every(f => f.trait === target));
  // はっきりした追加回答はスロットを置き換え、また3ならそのまま3：(5+3+3+3)/4 → 62.5
  assert.equal(r.scores[target], 62.5);
  assert.deepEqual(r.stages.followups.map(f => f.changed), [true, false]);
  assert.equal(r.stages.extraDuels.length, 0, "対決が明確（1）なら追加対決なし");
});

test("優勢が決まっていない領域の傾向を先に聞く", () => {
  // 領域1（向き合う・距離を取る）は両方3で左右差0、領域8の「解決する」は3だが「関係を戻す」が5で左右差50
  const und = new Set([...BASIC_BY_TRAIT["向き合う"], ...BASIC_BY_TRAIT["距離を取る"], ...BASIC_BY_TRAIT["解決する"]].map(i => i.id));
  const s = createSession();
  while (s.current().stage === 1) { const c = s.current(); s.answer(und.has(c.item.id) ? 3 : (c.item.trait === "関係を戻す" ? 5 : 4)); }
  const fu = s.plan.s2;
  assert.ok(fu.length === 6, "3傾向×2問");
  const order = fu.map(f => f.trait);
  assert.ok(order.lastIndexOf("向き合う") < order.indexOf("解決する") && order.lastIndexOf("距離を取る") < order.indexOf("解決する"), order.join(","));
});

test("追加対決：左右差<15 かつ 対決が3か「やや」の領域だけ", () => {
  const s = createSession();
  runAll(s, c => {
    if (c.stage === 3) return { 1: 3, 2: 2, 3: 1, 4: 5, 5: 4, 6: 3, 7: 3, 8: 3 }[c.item.domain];
    if (c.stage === 4) return 1;
    if (c.item.domain === 6) return c.item.trait === "主導する" ? 5 : 1;  // 領域6は左右差あり
    return 4;                                                             // 他は左右差0（はっきり回答なので追加質問なし）
  });
  const r = s.result();
  const doms = r.stages.extraDuels.map(e => e.domain).sort();
  assert.deepEqual(doms, [1, 2, 5, 7, 8]);
});

test("追加対決は基本の対決と向きを揃えて平均する（D2x は A/B が Q74 と逆）", () => {
  // Q74: A=熟考。1 → 熟考。D2x: A=即応, B=熟考。5 → 熟考。両方とも熟考寄り → 熟考 100
  const r = scoreFromAnswerMap({ 74: 1, 82: 5 });
  assert.equal(r.profile.duel[2].side, "熟考");
  assert.equal(r.profile.duel[2].strength, 100);
  const r2 = scoreFromAnswerMap({ 74: 2, 82: 2 });   // やや熟考 と やや即応 → 打ち消し合う
  assert.equal(r2.profile.duel[2].side, null);
});

// ---------------------------------------------------------------- 3. 言い換え・戻る・保存
test("swapWording：表現の番号を記録し、もう一方が無い設問では切り替えない", () => {
  const s = createSession();
  assert.equal(s.current().item.id, "Q1");
  assert.equal(s.current().canSwap, true);
  assert.equal(s.swapWording(), true);
  assert.equal(s.current().wordingIndex, 1);
  assert.equal(s.current().text, ITEM_BY_ID.Q1.wordings[1]);
  s.answer(4);
  assert.equal(s.log.find(e => e.type === "answer").wordingIndex, 1);
  assert.equal(s.records()[0].wordingIndex, 1);
  assert.equal(s.history().Q1[0].wordingIndex, 1);
  // Q48 は原版で表現A/Bが同文だったが、表現Bを書き下ろしたので切り替え可能になっている
  while (s.current().item.id !== "Q48") s.answer(3);
  assert.equal(s.current().canSwap, true, "Q48 は表現Bを新設したので切り替え可能");
  assert.notEqual(ITEM_BY_ID.Q48.wordings[0], ITEM_BY_ID.Q48.wordings[1]);
});

test("両方の表現を見せた設問は追加質問で聞き直さない", () => {
  const s = createSession();
  s.swapWording(); s.swapWording();     // Q1：B を見てから A に戻して 3
  runAll(s, c => 3);
  assert.ok(!s.plan.s2.some(f => f.itemId === "Q1"));
});

test("開始表現B：基本は表現B、追加質問は表現A、対決は variants[1]", () => {
  const s = createSession({ startWording: 1 });
  assert.equal(s.current().text, ITEM_BY_ID.Q1.wordings[1]);
  while (s.current().stage === 1) s.answer(3);
  assert.ok(s.plan.s2.every(f => f.wordingIndex === 0));
  while (s.current().stage === 2) s.answer(3);
  assert.equal(s.current().variant, ITEM_BY_ID.Q73.variants[1]);
});

test("back：前の設問に戻って答え直せる（以前の回答は prev として記録）", () => {
  const s = createSession();
  s.answer(5); s.answer(2);
  assert.equal(s.back(), true);
  assert.equal(s.current().item.id, "Q2");
  assert.equal(s.current().answer, 2);
  s.answer(4);
  assert.equal(s.current().item.id, "Q3");
  assert.equal(s.log.filter(e => e.type === "answer").at(-1).prev, 2);
  assert.equal(s.records().find(r => r.itemId === "Q2").answer, 4);
});

test("段階1に戻って回答を変えると追加質問を計画し直す", () => {
  const s = createSession();
  while (s.current().stage === 1) s.answer(3);
  const before = s.plan.s2.length;
  // 「待つ」の4問（Q9,33,59,72）のうち Q72 を戻って5に変えても、まだ3問未満なので追加は残る
  s.back(); assert.equal(s.current().item.id, "Q72");
  s.answer(5);
  assert.equal(s.current().stage, 2);
  assert.equal(s.plan.s2.length, before);
  assert.ok(!s.plan.s2.some(f => f.itemId === "Q72"), "はっきり答えた設問は聞き直さない");
});

test("toJSON / fromJSON：途中保存から再開して同じ結果", () => {
  const a = createSession();
  const f = (c) => (c.item.no * 7) % 5 + 1;
  for (let i = 0; i < 40; i++) a.answer(f(a.current()));
  a.swapWording();
  const b = Session.fromJSON(JSON.parse(JSON.stringify(a.toJSON())));
  assert.equal(b.current().key, a.current().key);
  assert.equal(b.current().wordingIndex, a.current().wordingIndex);
  runAll(a, f); runAll(b, f);
  assert.deepEqual(b.result().scores, a.result().scores);
  assert.deepEqual(b.result().select.chosen.map(h => h.meta.id), a.result().select.chosen.map(h => h.meta.id));
});

// ---------------------------------------------------------------- 4. 固定80問
test("adaptive=false：固定80問（全部3でも追加なし）", () => {
  const s = createSession({ adaptive: false });
  const n = runAll(s, () => 3);
  assert.equal(n, 80);
  assert.equal(s.steps().length, 80);
  const r = s.result();
  assert.equal(r.stages.followups.length, 0);
  assert.equal(r.stages.extraDuels.length, 0);
  assert.deepEqual(s.progress().stages.map(x => x.label), ["基本", "対決"]);
});

test("一貫性：基本平均との差が1.5以上なら不一致", () => {
  const r = scoreFromAnswerMap(SAMPLES[0].answers, 0);
  const q51 = r.consistency.find(c => c.itemId === "Q51");   // 石原：Q51=1、向き合う4問の平均4.25
  assert.equal(q51.flag, "不一致");
  assert.equal(r.consistency.length, 8);
  assert.equal(Object.keys(DOMAINS).length, r.duelDetail.length);
});

console.log(fail ? `\n${fail} failed, ${pass} passed` : `\nall ${pass} adaptive tests passed`);
process.exit(fail ? 1 : 0);
