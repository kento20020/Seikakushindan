// node tests/app_types.test.mjs
// 新しい画面（app/）の「診断結果の一覧」（#types。8つの軸 × 3つの型のタイプ図鑑。docs/app-screens.md §16。決定 U38）の DOM の無い部分
//  - app/js/type_catalog.js の typeCatalog：24件・並び（軸の順、各軸は A寄り → まんなか → B寄り）・名前と比率・絵のファイルがある
//    短い説明（lead）：A寄りは B<軸>-1、B寄りは B<軸>-3 の one と同じ。まんなかは型の文（midLead）
//    この型に近い見出し（near）：PATTERN_META にあり、状態が A 1・2／まんなか 5・6・7／B 3・4。見出しは PATTERN_META のまま
//  - typeMarks：サンプルの結果で、軸ごとに artSide(axisView(r, d)) と同じ型を指す（8つの軸の行の絵と同じ）。答えの無い軸は印なし
//  - 決定 U49（§24）：新しい一覧（既定）の説明は持ち主の原稿の文（copy：A寄り B<軸>-1・まんなか B<軸>-5・B寄り B<軸>-3 の題と本文、
//    一言は A寄り・B寄りだけ）。lead・near は前の一覧（?tc=old）だけが使うので、形はそのまま確かめる。?tc= の読み取り、前置きの文
//    「あなたの型」の印：新しい一覧はカードの文と同じ原稿の状態（1・2・1w → A寄り、3・4・3w → B寄り、5・6・7・7dd → まんなか、incomplete → なし）。
//    前の一覧（{ tc: "old" }）は今までどおり artSide(axisView(r, d))
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { typeCatalog, typeMarks, midLead, typeCopy, copySideOf, TYPE_SIDES, TYPE_RATIO, NEAR_STATES, COPY_STATE } from "../app/js/type_catalog.js";
import { domainStates3 } from "../js/engine3.js";
import { copyStatesOf3 } from "../js/result_copy3.js";
import { computeResult4 } from "../js/engine4.js";
import { DOMAIN_COPY4, SIDE_COPY4 } from "../js/data/result_copy4.js";
import { DEFAULT_TYPE_COPY, tcFromSearch, typeCopyVersion, isCopyTypes } from "../app/js/result_copy_version.js";
import { TYPES_LEAD_COPY, HOW_V3_COPY, HOW_V4_COPY } from "../app/js/types.js";
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

// ---------------------------------------------------------------- 原稿の文（決定 U49。新しい一覧の既定）
test("copy：A寄りは B<軸>-1、まんなかは B<軸>-5、B寄りは B<軸>-3 の題と本文（原稿の写しのまま）。一言は A寄り・B寄りだけ", () => {
  assert.deepEqual(COPY_STATE, { a: "1", mid: "5", b: "3" });
  for (const t of list) {
    const st = { a: "1", mid: "5", b: "3" }[t.side];
    const src = DOMAIN_COPY4[t.domain][st];
    assert.ok(t.copy, `${t.id} の copy`);
    assert.equal(t.copy.id, `B${t.domain}-${st}`, `${t.id} の原稿`);
    assert.equal(t.copy.title, src.title, `${t.id} の題は原稿のまま`);
    assert.equal(t.copy.body, src.body, `${t.id} の本文は原稿のまま`);
    if (t.side === "mid") assert.equal(t.copy.action, null, `${t.id}：まんなかには一言を出さない`);
    else assert.equal(t.copy.action, SIDE_COPY4[`${t.domain}${t.side === "a" ? "A" : "B"}`].action, `${t.id} の一言はその側の一言`);
    assert.deepEqual(t.copy, typeCopy(t.domain, t.side));
    for (const x of [t.copy.title, t.copy.body, t.copy.action ?? ""]) {
      assert.ok(!/B\d-|PAIR|_/.test(x), `${t.id}：中の ID やテーマの名前が文に入らない`);
      assert.ok(!/な人/.test(x), `${t.id}：「〜な人」と言わない`);
    }
  }
  // 24件の題はどれも違う（同じ文を2回並べない）
  assert.equal(new Set(list.map(t => t.copy.title)).size, 24);
  // 例：1 衝突への向き合い方
  assert.equal(list[0].copy.title, "話して、ふたりの間をほどいていく。");
  assert.equal(list[1].copy.title, "話す時間も、一人の時間も大切にする。");
  assert.equal(list[2].copy.title, "少し離れて、落ち着いて向き合う。");
  assert.equal(list[0].copy.action, "話したいことがあるんだけど、今少し話せる？");
  assert.equal(typeCopy(9, "a"), null);
  assert.equal(typeCopy(1, "x"), null);
});

test("?tc=：既定は原稿の文（copy）。?tc=old で前の一覧、知らない値は既定", () => {
  assert.equal(DEFAULT_TYPE_COPY, "copy");
  assert.equal(tcFromSearch("?tc=old"), "old");
  assert.equal(tcFromSearch("?dv=v3&tc=COPY"), "copy");
  assert.equal(tcFromSearch("?tc=x"), null);
  assert.equal(tcFromSearch(""), null);
  assert.equal(tcFromSearch(null), null);
  assert.equal(typeCopyVersion({ url: null }), "copy");
  assert.equal(typeCopyVersion({ url: "old" }), "old");
  assert.equal(typeCopyVersion({ url: null, def: "old" }), "old");
  assert.equal(typeCopyVersion({ url: "x", def: "y" }), "copy");
  assert.equal(isCopyTypes({ url: null }), true);
  assert.equal(isCopyTypes({ url: "old" }), false);
});

test("前置き（新しい一覧）：軸の基本説明と個別の具体例を区別し、型の決まり方は結果画面に頼らない", () => {
  assert.ok(TYPES_LEAD_COPY.includes("各軸の基本の説明"));
  assert.ok(TYPES_LEAD_COPY.includes("傾向の組み合わせは診断結果"));
  assert.ok(!TYPES_LEAD_COPY.includes("同じです"));
  assert.ok(!HOW_V3_COPY.includes("8つの軸"), "結果の画面の「8つの軸」（?rc3=old だけにある）に頼らない");
  assert.ok(HOW_V3_COPY.includes("よい・わるいはありません"));
  for (const x of [TYPES_LEAD_COPY, HOW_V3_COPY]) assert.ok(!/な人|%|％/.test(x));
});

// ---------------------------------------------------------------- 前の一覧（?tc=old）の文の出どころ（データは残してある）
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

test("typeMarks：結果が無ければ印なし（どちらの一覧でも）", () => {
  assert.deepEqual(typeMarks(null), { yours: {}, ids: [], hero: null });
  assert.deepEqual(typeMarks(undefined), { yours: {}, ids: [], hero: null });
  assert.deepEqual(typeMarks(null, { tc: "old" }), { yours: {}, ids: [], hero: null });
});

test("typeMarks（前の一覧 ?tc=old）：サンプルの結果で、軸ごとに artSide(axisView(r, d)) と同じ型（8つの軸の行の絵と同じ）", () => {
  assert.ok(results.length >= 2);
  const ids = new Set(list.map(t => t.id));
  let sawMid = false;
  for (const { name, r } of results) {
    const m = typeMarks(r, { tc: "old" });
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

test("typeMarks（前の一覧 ?tc=old）：答えの無い軸は印なし・まんなかの軸は <軸>-mid", () => {
  const { r } = results[0];
  const old = { tc: "old" };
  const none = { ...r, states: { ...r.states, 3: { ...r.states[3], a: 0, b: 0 } } };
  const m = typeMarks(none, old);
  assert.equal(m.yours[3], undefined, "答えの無い軸");
  assert.ok(!m.ids.some(id => id.startsWith("3-")));
  assert.equal(m.ids.length, 7);
  const tie = { ...r, states: { ...r.states, 5: { ...r.states[5], a: 2, b: 2 } } };
  assert.equal(typeMarks(tie, old).yours[5], "5-mid");
  const noStates = { ...r, states: {} };
  assert.deepEqual(typeMarks(noStates, old).ids, [], "どの軸にも答えが無ければ印なし");
});

// ---------------------------------------------------------------- あなたの型（新しい一覧。決定 U49：原稿の状態で）
/** 三択：領域ごとに W の左右の数と A・B の強さを決めて、domainStates3 で状態を出した結果 */
function result3Of(spec) {
  const levels = {}, w = {};
  for (const d of AXES) {
    const [a, b, LA, LB] = spec[d] ?? [2, 2, 50, 50];
    w[d] = { a, b };
    levels[DOMAINS[d].a] = LA;
    levels[DOMAINS[d].b] = LB;
  }
  return { version: "v3", states: domainStates3({ levels, w }), records: [], select: { chosen: [] } };
}

test("typeMarks（新しい一覧）：原稿の状態 1・2・1w → A寄り、3・4・3w → B寄り、5・6・7・7dd → まんなか、incomplete → 印なし", () => {
  assert.deepEqual(["1", "2", "1w", "3", "4", "3w", "5", "6", "7", "7dd", "incomplete", undefined].map(copySideOf),
    ["a", "a", "a", "b", "b", "b", "mid", "mid", "mid", "mid", null, null]);
});

test("typeMarks（新しい一覧・三択）：3:2 で状態7（拮抗）の軸は、左右の数では A寄りでも、まんなかに印", () => {
  const r = result3Of({ 1: [3, 2, 50, 50], 2: [4, 0, 80, 20], 3: [0, 4, 30, 50], 4: [2, 2, 80, 80], 5: [3, 2, 80, 20] });
  assert.equal(r.states[1].state, "7");
  assert.equal(r.states[2].state, "1");
  assert.equal(r.states[3].state, "3w");
  assert.equal(r.states[4].state, "5");
  assert.equal(r.states[5].state, null, "判定なし → 原稿の 7");
  const m = typeMarks(r, { tc: "copy" });
  assert.equal(m.yours[1], "1-mid", "3:2 で状態7 → まんなか（A が明確に優勢の文 B1-1 に印を付けない）");
  assert.equal(typeMarks(r, { tc: "old" }).yours[1], "1-a", "前の一覧は左右の数で A寄り（今までどおり）");
  assert.equal(m.yours[2], "2-a");
  assert.equal(m.yours[3], "3-b");
  assert.equal(m.yours[4], "4-mid");
  assert.equal(m.yours[5], "5-mid");
  assert.deepEqual(m.ids, AXES.map((d) => m.yours[d]), "軸の順・8つとも印");
  assert.equal(m.hero, typeMarks(r, { tc: "old" }).hero, "いちばん上の絵の印はどちらの一覧でも同じ");
  // 印の付いたカードの文は、その軸の原稿の状態の型の文（A寄り＝状態1・まんなか＝状態5・B寄り＝状態3）
  const byId = new Map(list.map((t) => [t.id, t]));
  assert.equal(byId.get(m.yours[1]).copy.id, "B1-5");
});

test("typeMarks（新しい一覧・三択）：サンプルの結果で、軸ごとに copyStatesOf3 の状態から決まる型", () => {
  for (const { name, r } of results) {
    const m = typeMarks(r, { tc: "copy" });
    const st = copyStatesOf3(r);
    for (const d of AXES) assert.equal(m.yours[d], `${d}-${copySideOf(st[d])}`, `${name}：軸 ${d}（状態 ${st[d]}）`);
    assert.equal(m.ids.length, 8, `${name}：三択では8つとも印`);
    assert.equal(m.hero, heroArt(r)?.id ?? null, `${name}：いちばん上の絵の型`);
  }
  assert.equal(typeMarks(results[0].r).ids.length, 8, "既定（Node では URL が無い）は新しい一覧");
});

test("typeMarks（新しい一覧・24問）：A が多い → A寄り、B が多い → B寄り、同じ数・向きの違い（普段と2つの場面が逆）→ まんなか、答えが2問より少ない → 印なし", () => {
  const V = { A: 1, B: -1, "?": null };
  const answers = {};
  const spec = { 1: "AAA", 2: "AAB", 3: "BAB", 4: "BBB", 5: "AB?", 6: "A??", 7: "ABB", 8: "BAA" };
  for (const [d, x] of Object.entries(spec)) ["U", "P", "N"].forEach((k, i) => {
    answers[`${k}${d}`] = V[x[i]] === null ? { status: "unknown", value: null } : { status: "answered", value: V[x[i]] };
  });
  const r = computeResult4(answers);
  assert.equal(r.domains[7].differentDirections, true, "軸7：普段 A・場面 B・B（向きが逆）");
  const m = typeMarks(r, { tc: "copy" });
  assert.deepEqual(m.yours, { 1: "1-a", 2: "2-a", 3: "3-b", 4: "4-b", 5: "5-mid", 7: "7-mid", 8: "8-mid" });
  // 前の一覧は A を選んだ割合（向きの違いの軸7・8 は B寄り・A寄り）
  const o = typeMarks(r, { tc: "old" });
  assert.equal(o.yours[7], "7-b");
  assert.equal(o.yours[8], "8-a");
  assert.equal(o.yours[6], undefined);
  assert.equal(m.hero, o.hero);
});

test("前置き（新しい一覧）：印の決まり方の文が、原稿の状態の決め方と合う", () => {
  assert.ok(HOW_V3_COPY.includes("はっきり") && HOW_V3_COPY.includes("まんなか"));
  assert.ok(HOW_V4_COPY.includes("向きが逆") && HOW_V4_COPY.includes("印を付けません"));
  for (const x of [HOW_V3_COPY, HOW_V4_COPY]) assert.ok(!/な人|%|％|8つの軸/.test(x));
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
