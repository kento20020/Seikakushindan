// node tests/app_types.test.mjs
// 新しい画面（app/）の「診断結果の一覧」（#types。8つの軸 × 3つの型のタイプ図鑑。docs/app-screens.md §16。決定 U38）の DOM の無い部分
//  - app/js/type_catalog.js の typeCatalog：24件・並び（軸の順、各軸は A寄り → まんなか → B寄り）・名前と比率・絵のファイルがある
//    短い説明（lead）：A寄りは B<軸>-1、B寄りは B<軸>-3 の one と同じ。まんなかは型の文（midLead）
//    この型に近い見出し（near）：PATTERN_META にあり、状態が A 1・2／まんなか 5・6・7／B 3・4。見出しは PATTERN_META のまま
//  - typeMarks：サンプルの結果で、軸ごとに artSide(axisView(r, d)) と同じ型を指す（8つの軸の行の絵と同じ）。答えの無い軸は印なし
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { typeCatalog, typeMarks, midLead, TYPE_SIDES, TYPE_RATIO, NEAR_STATES } from "../app/js/type_catalog.js";
import { AXIS_ART, artSide, heroArt, slotMarks } from "../app/js/axis_art.js";
import { axisView } from "../app/js/summary.js";
import { DOMAINS } from "../js/engine3.js";
import { PATTERN_META } from "../js/data/patterns_meta.js";
import { BASIC_TEXT } from "../js/data/patterns_text_basic.js";
import { fromLikertAnswers, fromScores } from "../js/adaptive3.js";
import { SAMPLES3, PROFILE_SAMPLES3 } from "../js/data/samples3.js";

let fail = 0, pass = 0;
function test(name, fn) {
  try { fn(); pass++; console.log("OK   " + name); }
  catch (e) { fail++; console.log("FAIL " + name + "\n  " + (e.stack || e).toString().split("\n").slice(0, 6).join("\n  ")); }
}

const appFile = (p) => new URL(`../app/${p}`, import.meta.url);
const META = new Map(PATTERN_META.map(m => [m.id, m]));
const AXES = Object.keys(DOMAINS).map(Number).sort((x, y) => x - y);
const list = typeCatalog();

// ---------------------------------------------------------------- 並び・形
test("24件（8つの軸 × 3つの型）で、軸の順・各軸は A寄り → まんなか → B寄り", () => {
  assert.equal(AXES.length, 8);
  assert.equal(list.length, 24);
  assert.deepEqual(TYPE_SIDES, ["a", "mid", "b"]);
  assert.deepEqual(list.map(t => t.id), AXES.flatMap(d => [`${d}-a`, `${d}-mid`, `${d}-b`]));
  assert.deepEqual(list.map(t => t.domain), AXES.flatMap(d => [d, d, d]));
  assert.deepEqual(list.map(t => t.side), AXES.flatMap(() => ["a", "mid", "b"]));
  assert.equal(new Set(list.map(t => t.id)).size, 24, "id が重ならない");
});

test("軸の名前・型の名前・比率・色は DOMAINS と AXIS_ART のまま", () => {
  for (const t of list) {
    const D = DOMAINS[t.domain];
    assert.equal(t.axisName, D.name, `${t.id} の軸の名前`);
    assert.equal(t.aName, D.a);
    assert.equal(t.bName, D.b);
    assert.equal(t.label, t.side === "a" ? D.a : t.side === "b" ? D.b : "まんなか", `${t.id} の型の名前`);
    assert.equal(t.title, t.side === "a" ? `A寄り：${D.a}` : t.side === "b" ? `B寄り：${D.b}` : "まんなか", `${t.id} の題`);
    assert.equal(t.ratio, { a: "75:25", mid: "50:50", b: "25:75" }[t.side], `${t.id} の比率`);
    assert.equal(t.ratio, TYPE_RATIO[t.side]);
    assert.equal(t.color, AXIS_ART[t.domain].color, `${t.id} の色`);
    assert.equal(t.deep, AXIS_ART[t.domain].deep);
  }
  // 例：1「衝突への向き合い方」向き合う／距離を取る
  assert.equal(list[0].title, "A寄り：向き合う");
  assert.equal(list[2].title, "B寄り：距離を取る");
  assert.equal(list[0].axisName, "衝突への向き合い方");
});

test("全件の絵のファイルがあり、alt がある（AXIS_ART の絵）", () => {
  for (const t of list) {
    const def = AXIS_ART[t.domain][t.side];
    assert.ok(def, `${t.id}：AXIS_ART に絵がある`);
    assert.equal(t.art.file, def.file, `${t.id} の絵`);
    assert.equal(t.art.file, `img/axes/${t.id}.jpg`);
    assert.equal(t.art.alt, def.alt);
    assert.ok(t.art.alt && t.art.alt.trim(), `${t.id} の alt`);
    assert.ok(existsSync(appFile(t.art.file)), `${t.art.file} がある`);
  }
});

// ---------------------------------------------------------------- 文の出どころ
test("lead：空でなく、A寄りは B<軸>-1、B寄りは B<軸>-3 の one と同じ。まんなかは型の文", () => {
  for (const t of list) {
    assert.ok(typeof t.lead === "string" && t.lead.trim(), `${t.id} の lead が空でない`);
    if (t.side === "a") {
      assert.equal(t.leadFrom, `B${t.domain}-1`);
      assert.equal(t.lead, BASIC_TEXT[`B${t.domain}-1`].one, `${t.id}：B${t.domain}-1 の one`);
    } else if (t.side === "b") {
      assert.equal(t.leadFrom, `B${t.domain}-3`);
      assert.equal(t.lead, BASIC_TEXT[`B${t.domain}-3`].one, `${t.id}：B${t.domain}-3 の one`);
    } else {
      assert.equal(t.leadFrom, null);
      assert.equal(t.lead, midLead(t.domain));
      const D = DOMAINS[t.domain];
      assert.ok(t.lead.includes(D.a) && t.lead.includes(D.b), `${t.id}：両方の傾向の名前が入る`);
      // 5・6・7 の one は使わない（型の文）
      for (const s of ["5", "6", "7"]) assert.notEqual(t.lead, BASIC_TEXT[`B${t.domain}-${s}`].one);
    }
    assert.ok(!/な人/.test(t.lead), `${t.id}：「〜な人」と言わない`);
  }
  assert.equal(midLead(1), "「向き合う」と「距離を取る」が半々で、どちらか一方には寄っていない。");
  assert.equal(midLead(99), "");
});

test("near：PATTERN_META にあり、状態が A 1・2／まんなか 5・6・7／B 3・4。見出しは PATTERN_META のまま。弱い版は使わない", () => {
  assert.deepEqual(NEAR_STATES, { a: ["1", "2"], mid: ["5", "6", "7"], b: ["3", "4"] });
  const want = { a: ["1", "2"], mid: ["5", "6", "7"], b: ["3", "4"] };
  for (const t of list) {
    assert.deepEqual(t.near.map(n => n.id), want[t.side].map(s => `B${t.domain}-${s}`), `${t.id} の near`);
    for (const n of t.near) {
      const m = META.get(n.id);
      assert.ok(m, `${n.id} が PATTERN_META にある`);
      assert.equal(m.kind, "basic");
      assert.deepEqual(m.cond, { type: "basic", d: t.domain, s: n.id.split("-")[1] }, `${n.id} の条件（軸と状態）`);
      assert.equal(n.headline, m.headline, `${n.id} の見出しはそのまま`);
      assert.ok(n.headline.trim());
      assert.ok(!n.id.endsWith("w"), "弱い版は使わない");
    }
  }
  // 24件で near は 8軸 × (2 + 3 + 2) = 56本（基本パターン 56本をちょうど1回ずつ）
  const all = list.flatMap(t => t.near.map(n => n.id));
  assert.equal(all.length, 56);
  assert.equal(new Set(all).size, 56);
  assert.deepEqual(new Set(all), new Set(PATTERN_META.filter(m => m.kind === "basic" && !m.id.endsWith("w")).map(m => m.id)));
});

// ---------------------------------------------------------------- 印（あなたの型）
const results = [
  ...SAMPLES3.map(s => ({ name: s.key, r: fromLikertAnswers(s.answers, s.wording, { version: "v3" }).result() })),
  ...PROFILE_SAMPLES3.map(p => ({ name: p.key, r: fromScores(p.scores, p.duel, { version: "v3" }).result() })),
];

test("typeMarks：結果が無ければ印なし", () => {
  assert.deepEqual(typeMarks(null), { yours: {}, ids: [], hero: null });
  assert.deepEqual(typeMarks(undefined), { yours: {}, ids: [], hero: null });
});

test("typeMarks：サンプルの結果で、軸ごとに artSide(axisView(r, d)) と同じ型（8つの軸の行の絵と同じ）", () => {
  assert.ok(results.length >= 2);
  const ids = new Set(list.map(t => t.id));
  let sawMid = false;
  for (const { name, r } of results) {
    const m = typeMarks(r);
    for (const d of AXES) {
      const side = artSide(axisView(r, d));
      if (side) assert.equal(m.yours[d], `${d}-${side}`, `${name}：軸 ${d}`);
      else assert.equal(m.yours[d], undefined, `${name}：軸 ${d} は答えが無いので印なし`);
      if (side === "mid") sawMid = true;
    }
    assert.deepEqual(m.ids, Object.values(m.yours), `${name}：ids は軸の順`);
    assert.deepEqual(m.ids, slotMarks(r).picked, `${name}：slotMarks と同じ選び方`);
    assert.ok(m.ids.every(id => ids.has(id)), `${name}：一覧にある型`);
    assert.equal(m.hero, heroArt(r)?.id ?? null, `${name}：いちばん上の絵の型`);
  }
  assert.ok(sawMid, "まんなかの軸があるサンプルも確かめている（P5）");
});

test("typeMarks：答えの無い軸は印なし・まんなかの軸は <軸>-mid", () => {
  const { r } = results[0];
  const none = { ...r, states: { ...r.states, 3: { ...r.states[3], a: 0, b: 0 } } };
  const m = typeMarks(none);
  assert.equal(m.yours[3], undefined, "答えの無い軸");
  assert.ok(!m.ids.some(id => id.startsWith("3-")));
  assert.equal(m.ids.length, 7);
  const tie = { ...r, states: { ...r.states, 5: { ...r.states[5], a: 2, b: 2 } } };
  assert.equal(typeMarks(tie).yours[5], "5-mid");
  const noStates = { ...r, states: {} };
  assert.deepEqual(typeMarks(noStates).ids, [], "どの軸にも答えが無ければ印なし");
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
