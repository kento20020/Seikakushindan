// node tests/engine4.test.mjs
// 24問版（v4。決定 U42）の採点（js/engine4.js）。仕様：docs/diagnosis-v4.md §5〜§7（持ち主の仕様書（2026-10-20）§6・§7）
//  - classifyDomain：すべての状態（1・2・3・4・5・6・7〔differentDirections あり・なし〕・1w・3w・incomplete）の表。仕様書のコードそのまま
//  - 値の読み方：不正な値は未回答。判断できない（null）と未回答（キーなし）を分ける
//  - 主軸と補足の並べ方（選ばれた側の評定 → |p| → |a−b| → 領域の番号）、候補が無いときの見出し
//  - 組み合わせ（§7.2）：優勢・高／中／低・specialA/B/C・shape allA、最大2件・重要度の順・同じ領域の集合は1件
//  - 文（§6.2）：状態の見出しと本文、状態7で differentDirections のときの本文、p の補足
import assert from "node:assert/strict";
import {
  classifyDomain, differentDirections4, valueOf, domainOf, computeResult4, rankCandidates4, combinations4, dominant4, clause4,
  stateText4, domainText4, prefText4, ratingLabel4, isRating4, isPref4, traitList4, CANDIDATE_STATES4, LEAD_TITLE4, DIFFERENT_DIRECTIONS_TEXT4,
} from "../js/engine4.js";
import { QUESTION_ORDER4 } from "../js/data/questions4.js";
import { PATTERN_META } from "../js/data/patterns_meta.js";
import { DOMAINS } from "../js/engine.js";

let fail = 0, pass = 0;
function test(name, fn) {
  try { fn(); pass++; console.log("OK   " + name); }
  catch (e) { fail++; console.log("FAIL " + name + "\n  " + (e.stack || e).toString().split("\n").slice(0, 6).join("\n  ")); }
}

const ans = (v) => (v === null ? { status: "unknown", value: null } : { status: "answered", value: v });
/** 領域ごとの [a, b, p]（null は判断できない、undefined は未回答）から answers */
function answersOf(spec) {
  const out = {};
  for (const [d, [a, b, p]] of Object.entries(spec)) {
    if (a !== undefined) out[`R${d}A`] = ans(a);
    if (b !== undefined) out[`R${d}B`] = ans(b);
    if (p !== undefined) out[`P${d}`] = ans(p);
  }
  return out;
}
/** 8領域すべてを同じ値で（一部だけ上書き） */
const all = (abp, over = {}) => answersOf(Object.fromEntries([1, 2, 3, 4, 5, 6, 7, 8].map((d) => [d, over[d] ?? abp])));

// ---------------------------------------------------------------- classifyDomain（§6.2）
// [a, b, p, 状態, differentDirections]
const TABLE = [
  [null, 3, 1, "incomplete", false], [3, null, 1, "incomplete", false], [3, 3, null, "incomplete", false], [null, null, null, "incomplete", false],
  [0, 1, 2, "6", false], [1, 1, -2, "6", false], [0, 0, 0, "6", false], [1, 0, -1, "6", false],
  [4, 1, -1, "7", true], [1, 3, 2, "7", true], [4, 2, -2, "7", true], [0, 2, 1, "7", true],
  [3, 4, 1, "2", false], [4, 4, 2, "2", false], [3, 2, 1, "2", false], [4, 2, 2, "2", false],
  [4, 3, -1, "4", false], [3, 3, -2, "4", false], [2, 3, -1, "4", false], [2, 4, -2, "4", false],
  [3, 3, 0, "5", false], [4, 3, 0, "5", false], [4, 4, 0, "5", false],
  [4, 0, 2, "1", false], [3, 1, 1, "1", false],
  [0, 4, -2, "3", false], [1, 3, -1, "3", false],
  [2, 0, 1, "1w", false], [2, 2, 2, "1w", false], [2, 1, 2, "1w", false],
  [0, 2, -1, "3w", false], [2, 2, -1, "3w", false],
  [1, 2, 1, "7", false], [2, 1, -1, "7", false], [3, 1, 0, "7", false], [2, 2, 0, "7", false], [1, 2, 0, "7", false],
];

test("classifyDomain：すべての状態の表（仕様書のコードのとおり）", () => {
  const seen = new Set();
  for (const [a, b, p, st, dd] of TABLE) {
    assert.equal(classifyDomain(a, b, p), st, `(${a}, ${b}, ${p})`);
    assert.equal(differentDirections4(a, b, p), dd, `dd (${a}, ${b}, ${p})`);
    seen.add(st + (st === "7" ? (dd ? "dd" : "") : ""));
  }
  for (const st of ["1", "2", "3", "4", "5", "6", "7", "7dd", "1w", "3w", "incomplete"]) assert.ok(seen.has(st), `表に ${st} がある`);
});

test("classifyDomain：125通りすべてで決まった状態のどれか。候補の状態の向きは p の向きと同じ", () => {
  const ok = new Set(["1", "2", "3", "4", "5", "6", "7", "1w", "3w"]);
  for (let a = 0; a <= 4; a++) for (let b = 0; b <= 4; b++) for (let p = -2; p <= 2; p++) {
    const st = classifyDomain(a, b, p);
    assert.ok(ok.has(st), `${a},${b},${p} → ${st}`);
    if (["1", "2", "1w"].includes(st)) assert.ok(p > 0);
    if (["3", "4", "3w"].includes(st)) assert.ok(p < 0);
    if (st === "5") assert.ok(p === 0 && a >= 3 && b >= 3);
    if (st === "6") assert.ok(a <= 1 && b <= 1);
    // differentDirections なら必ず状態7（両方が少ないときは6が先）
    if (differentDirections4(a, b, p) && !(a <= 1 && b <= 1)) assert.equal(st, "7");
  }
});

// ---------------------------------------------------------------- 値の読み方
test("valueOf：正しい値だけ読む。判断できないは null、未回答・不正な値は undefined", () => {
  assert.equal(valueOf({ R1A: ans(3) }, "R1A"), 3);
  assert.equal(valueOf({ R1A: ans(null) }, "R1A"), null);
  assert.equal(valueOf({}, "R1A"), undefined);
  for (const bad of [NaN, 5, -1, 2.5, "3", Infinity, true, {}, [1]]) assert.equal(valueOf({ R1A: { status: "answered", value: bad } }, "R1A"), undefined, String(bad));
  assert.equal(valueOf({ P1: { status: "answered", value: 3 } }, "P1"), undefined, "P は −2〜＋2");
  assert.equal(valueOf({ P1: { status: "answered", value: -2 } }, "P1"), -2);
  assert.equal(valueOf({ R1A: { status: "unknown", value: 2 } }, "R1A"), undefined, "unknown は value null だけ");
  assert.equal(valueOf({ R1A: { status: "skip", value: null } }, "R1A"), undefined);
  assert.equal(valueOf({ R1A: 3 }, "R1A"), undefined);
  assert.equal(valueOf(null, "R1A"), undefined);
  assert.ok(isRating4(0) && isRating4(4) && !isRating4(4.0001) && !isRating4("1"));
  assert.ok(isPref4(-2) && isPref4(2) && !isPref4(-3) && !isPref4("0"));
});

test("domainOf：判断できない（unknown）と未回答（unanswered）を分けて missing に。どちらも incomplete", () => {
  const d = domainOf({ R1A: ans(3), R1B: ans(null) }, 1);
  assert.equal(d.state, "incomplete");
  assert.equal(d.a, 3); assert.equal(d.b, null); assert.equal(d.p, null);
  assert.deepEqual(d.missing, [{ id: "R1B", status: "unknown" }, { id: "P1", status: "unanswered" }]);
  assert.equal(d.differentDirections, false);
  const e = domainOf({ R1A: ans(4), R1B: ans(1), P1: ans(-1) }, 1);
  assert.equal(e.state, "7"); assert.equal(e.differentDirections, true); assert.deepEqual(e.missing, []);
});

// ---------------------------------------------------------------- 結果
test("computeResult4：形（traits は rating と rating×25、domains、主軸、patternIds）。confidence は作らない", () => {
  const r = computeResult4(all([4, 0, 2]));
  assert.equal(r.diagnosisVersion, "v4");
  assert.equal(r.questionBankVersion, "v4-24-2026-10-20");
  assert.equal(Object.keys(r.traits).length, 16);
  assert.deepEqual(r.traits["向き合う"], { rating: 4, displayValue: 100 });
  assert.deepEqual(r.traits["距離を取る"], { rating: 0, displayValue: 0 });
  for (let d = 1; d <= 8; d++) assert.equal(r.domains[d].state, "1");
  assert.equal(r.primaryDomainId, 1);
  assert.deepEqual(r.supportingDomainIds, [2, 3]);
  assert.equal(r.lead, "primary");
  assert.deepEqual(r.counts, { answered: 24, unknown: 0, unanswered: 0 });
  assert.ok(!("confidence" in r));
  assert.ok(JSON.stringify(r).indexOf("confidence") < 0);
  assert.deepEqual(r.patternIds.slice(0, 8), [1, 2, 3, 4, 5, 6, 7, 8].map((d) => `B${d}-1`));
});

test("traits の displayValue：0/25/50/75/100、答えが無ければ null", () => {
  const r = computeResult4(answersOf({ 1: [0, 1, 0], 2: [2, 3, 0], 3: [4, null, 0] }));
  assert.deepEqual([r.traits["向き合う"].displayValue, r.traits["距離を取る"].displayValue, r.traits["即応"].displayValue, r.traits["熟考"].displayValue, r.traits["追う"].displayValue],
    [0, 25, 50, 75, 100]);
  assert.deepEqual(r.traits["待つ"], { rating: null, displayValue: null });
  assert.deepEqual(r.traits["表に出す"], { rating: null, displayValue: null });
});

test("主軸と補足の並べ方：選ばれた側の評定 → |p| → |a−b| の大きい順、同じなら領域の番号順", () => {
  // 1: 状態1（自分の側 4・|p| 2・|a−b| 4）、2: 状態1（4・1・4）、3: 状態3（4・2・4。1 と同じ → 番号順）、4: 状態2（3）、5: 1w（2）、6〜8: 候補でない
  const r = computeResult4(answersOf({ 1: [4, 0, 2], 2: [4, 0, 1], 3: [0, 4, -2], 4: [3, 2, 1], 5: [2, 0, 1], 6: [3, 3, 0], 7: [0, 0, 0], 8: [1, 2, 1] }));
  assert.deepEqual(rankCandidates4(r.domains).map((x) => x.domain), [1, 3, 2, 4, 5]);
  assert.equal(r.primaryDomainId, 1);
  assert.deepEqual(r.supportingDomainIds, [3, 2]);
  // |a−b| で決まる：1 は状態2（4・2・|a−b| 2）、2 は状態1（4・2・4）→ 2 が先
  const r2 = computeResult4(all([0, 0, 0], { 1: [4, 2, 2], 2: [4, 0, 2] }));
  assert.equal(r2.primaryDomainId, 2);
  assert.deepEqual(r2.supportingDomainIds, [1]);
  // 選ばれた側の評定が先（B 側の領域は b を見る）
  const r3 = computeResult4(all([0, 0, 0], { 1: [3, 1, 2], 6: [0, 4, -1] }));
  assert.equal(r3.primaryDomainId, 6);
  assert.deepEqual(r3.supportingDomainIds, [1]);
  for (const d of [r.primaryDomainId, ...r.supportingDomainIds]) assert.ok(CANDIDATE_STATES4.includes(r.domains[d].state));
});

test("候補が無いとき：状態5があれば『複数の傾向を持つ』、無ければ『今回の回答では、片側に強く寄らない傾向』、完全に答えた領域が0なら none", () => {
  const multi = computeResult4(all([0, 0, 0], { 2: [3, 3, 0], 5: [4, 4, 0], 7: [4, 1, -1] }));
  assert.equal(multi.lead, "multiple");
  assert.equal(multi.primaryDomainId, null);
  assert.deepEqual(multi.supportingDomainIds, []);
  assert.deepEqual(multi.multipleDomainIds, [2, 5]);
  assert.equal(LEAD_TITLE4.multiple, "複数の傾向を持つ");
  const flat = computeResult4(all([1, 1, 0], { 3: [2, 2, 0], 4: [4, 1, -2] }));
  assert.equal(flat.lead, "flat");
  assert.equal(LEAD_TITLE4.flat, "今回の回答では、片側に強く寄らない傾向");
  const none = computeResult4(all([4, 0, null]));
  assert.equal(none.lead, "none");
  assert.equal(none.primaryDomainId, null);
  assert.deepEqual(none.completeDomainIds, []);
  assert.deepEqual(none.patternIds, []);
  assert.deepEqual(none.combos, []);
  assert.equal(none.counts.unknown, 8);
  // 答えた分の個別の値は残る
  assert.equal(none.domains[1].a, 4);
  assert.equal(none.traits["向き合う"].rating, 4);
});

test("答えがそろわない領域は主軸・組み合わせに使わない（埋め合わせない）", () => {
  const r = computeResult4(all([0, 0, 0], { 1: [4, 0, null], 2: [3, 0, 1] }));
  assert.equal(r.domains[1].state, "incomplete");
  assert.equal(r.primaryDomainId, 2);
  assert.ok(!r.patternIds.some((id) => id.startsWith("B1-")));
  assert.ok(r.combos.every((c) => !c.domains.includes(1)));
});

// ---------------------------------------------------------------- 組み合わせ（§7.2）
const metaOf = (id) => PATTERN_META.find((m) => m.id === id);

test("優勢:t：完全に答えて p が t の側、t の評定 3以上・反対側以上、differentDirections でない。1w/3w は成立しない", () => {
  const dom = (abp) => computeResult4(answersOf({ 1: abp })).domains;
  assert.equal(dominant4(dom([3, 3, 1]), "向き合う"), true);
  assert.equal(dominant4(dom([4, 0, 2]), "向き合う"), true);
  assert.equal(dominant4(dom([4, 0, 2]), "距離を取る"), false);
  assert.equal(dominant4(dom([3, 4, 1]), "向き合う"), false, "反対側の方が高い");
  assert.equal(dominant4(dom([2, 0, 2]), "向き合う"), false, "1w");
  assert.equal(dominant4(dom([4, 0, 0]), "向き合う"), false, "p が 0");
  assert.equal(dominant4(dom([4, 1, -1]), "距離を取る"), false, "differentDirections");
  assert.equal(dominant4(dom([4, 0, null]), "向き合う"), false, "答えがそろわない");
});

test("高／中／低：評定 3〜4／2／0〜1。欠けた値の条件は成り立たない", () => {
  const r = computeResult4(answersOf({ 1: [3, 2, 0], 2: [1, null, 0] }));
  assert.ok(clause4(r.domains, r.traits, "高:向き合う"));
  assert.ok(clause4(r.domains, r.traits, "中:距離を取る"));
  assert.ok(clause4(r.domains, r.traits, "低:即応"));
  assert.ok(!clause4(r.domains, r.traits, "高:熟考") && !clause4(r.domains, r.traits, "低:熟考") && !clause4(r.domains, r.traits, "中:熟考"));
  assert.ok(!clause4(r.domains, r.traits, "高:知らない傾向"));
});

test("すべて A が優勢：重要度5の候補（S01・S05・S19）から、ID の順に最大2件。文は条件の傾向", () => {
  const r = computeResult4(all([4, 0, 2]));
  assert.deepEqual(r.combos.map((c) => c.id), ["S01", "S05"]);
  assert.equal(r.combos[0].text, "「向き合う」「主導する」と「解決する」があわせて見られます。");
  assert.deepEqual(r.combos[0].domains, [1, 6, 8]);
  assert.deepEqual(r.patternIds.slice(8), ["S01", "S05"]);
});

test("shape：allA は8領域すべてで A が優勢のときだけ候補。low・high・mid は使わない", () => {
  const only = (id) => PATTERN_META.filter((m) => m.id === id);
  const allA = computeResult4(all([4, 0, 2]));
  assert.deepEqual(combinations4(allA.domains, allA.traits, only("S19")).map((c) => c.id), ["S19"]);
  assert.equal(combinations4(allA.domains, allA.traits, only("S19"))[0].text,
    `${traitList4([1, 2, 3, 4, 5, 6, 7, 8].map((d) => DOMAINS[d].a))}があわせて見られます。`);
  const almost = computeResult4(all([4, 0, 2], { 8: [4, 0, null] }));
  assert.deepEqual(combinations4(almost.domains, almost.traits, only("S19")), []);
  const lows = computeResult4(all([0, 0, 0]));
  const highs = computeResult4(all([4, 4, 0]));
  for (const r of [lows, highs]) assert.deepEqual(combinations4(r.domains, r.traits, ["S16", "S17", "S18"].flatMap(only)), []);
});

test("specialC：関係する領域がすべて完全で p＝0 のときだけ。specialB：関係する領域が完全でないと候補にならない", () => {
  const S13 = [metaOf("S13")];   // 高:向き合う・高:距離を取る・高:追う・高:待つ（領域 1・3）
  const yes = computeResult4(all([0, 0, 0], { 1: [4, 4, 0], 3: [3, 4, 0] }));
  assert.deepEqual(combinations4(yes.domains, yes.traits, S13).map((c) => c.id), ["S13"]);
  const no = computeResult4(all([0, 0, 0], { 1: [4, 4, 1], 3: [3, 4, 0] }));
  assert.deepEqual(combinations4(no.domains, no.traits, S13), []);
  const S07 = [metaOf("S07")];   // 高:主導する・高:待つ（領域 3・6）
  const b = computeResult4(all([0, 0, 0], { 3: [0, 4, -2], 6: [4, 0, 2] }));
  assert.deepEqual(combinations4(b.domains, b.traits, S07).map((c) => c.id), ["S07"]);
  const bMissing = computeResult4(all([0, 0, 0], { 3: [0, 4, null], 6: [4, 0, 2] }));
  assert.deepEqual(combinations4(bMissing.domains, bMissing.traits, S07), []);
});

test("同じ領域の集合の候補は1件だけ（S07 と、領域 3・6 の cross が両方成り立つとき）", () => {
  const r = computeResult4(all([0, 0, 0], { 3: [0, 4, -2], 6: [4, 0, 2] }));
  const cands = PATTERN_META.filter((m) => m.kind !== "basic" && String([...m.domains].sort()) === "3,6");
  const found = combinations4(r.domains, r.traits, cands);
  assert.equal(found.length, 1);
  // ふつうの結果でも、同じ集合が2回出ない
  const keys = r.combos.map((c) => [...c.domains].sort().join(","));
  assert.equal(new Set(keys).size, keys.length);
});

test("いろいろな答えで：組み合わせは最大2件・重要度の大きい順（同じなら ID 順）・同じ領域の集合なし・主軸は組み合わせで変わらない", () => {
  let seed = 7;
  const rnd = (n) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
  for (let k = 0; k < 400; k++) {
    const answers = {};
    for (const id of QUESTION_ORDER4) {
      if (rnd(12) === 0) { answers[id] = ans(null); continue; }
      answers[id] = ans(id.startsWith("R") ? rnd(5) : rnd(5) - 2);
    }
    const r = computeResult4(answers);
    assert.ok(r.combos.length <= 2);
    const imp = r.combos.map((c) => metaOf(c.id).importance);
    for (let i = 1; i < imp.length; i++) assert.ok(imp[i - 1] > imp[i] || (imp[i - 1] === imp[i] && r.combos[i - 1].id < r.combos[i].id));
    const keys = r.combos.map((c) => [...c.domains].sort().join(","));
    assert.equal(new Set(keys).size, keys.length);
    for (const c of r.combos) {
      assert.ok(c.domains.every((d) => r.domains[d].state !== "incomplete"));
      assert.ok(!["S16", "S17", "S18"].includes(c.id));
    }
    const ranked = rankCandidates4(r.domains);
    assert.equal(r.primaryDomainId, ranked[0]?.domain ?? null);
  }
});

// ---------------------------------------------------------------- 文（§6.2）
test("状態の見出しと本文（A・B は傾向の名前）。状態7で differentDirections のときだけ別の本文", () => {
  assert.deepEqual(stateText4("1", "向き合う", "距離を取る"), { title: "「向き合う」を選びやすい", body: "普段の回答では「向き合う」の当てはまりが多く、今回の場面でも「向き合う」を選ぶ傾向が見られます。" });
  assert.equal(stateText4("2", "即応", "熟考").title, "「即応」を先に選び、「熟考」も持つ");
  assert.equal(stateText4("3", "追う", "待つ").title, "「待つ」を選びやすい");
  assert.equal(stateText4("4", "追う", "待つ").title, "「待つ」を先に選び、「追う」も持つ");
  assert.equal(stateText4("5", "A", "B").title, "どちらの傾向もある");
  assert.equal(stateText4("6", "A", "B").title, "どちらも強くは当てはまらない");
  assert.equal(stateText4("7", "A", "B").title, "片側だけにはまとまらない");
  assert.equal(stateText4("7", "向き合う", "距離を取る").body, "今回の回答では、「向き合う」か「距離を取る」のどちらか一方だけには整理しきれませんでした。");
  assert.equal(stateText4("7", "A", "B", { differentDirections: true }).body, DIFFERENT_DIRECTIONS_TEXT4);
  assert.equal(DIFFERENT_DIRECTIONS_TEXT4, "普段の傾向と今回の場面で選んだ行動に違いがありました。一方だけに決めず、両方の回答を残しています。");
  assert.equal(stateText4("1w", "表に出す", "内に置く").title, "「表に出す」をやや選びやすい");
  assert.equal(stateText4("3w", "表に出す", "内に置く").body, "場面の選択は「内に置く」寄りですが、普段の当てはまりは中程度でした。");
  assert.deepEqual(stateText4("incomplete", "A", "B"), { title: "この領域はまだ分かりません", body: "判断できない項目があるため、この領域の組み合わせは判定していません。" });
  const dd = computeResult4(answersOf({ 1: [4, 1, -1] })).domains[1];
  assert.equal(domainText4(dd).body, DIFFERENT_DIRECTIONS_TEXT4);
});

test("p の補足と評定のラベル", () => {
  assert.deepEqual([2, 1, 0, -1, -2].map((p) => prefText4(p, "向き合う", "距離を取る")),
    ["向き合う寄り", "やや向き合う寄り", "同程度", "やや距離を取る寄り", "距離を取る寄り"]);
  assert.equal(prefText4(null, "A", "B"), "判断できない");
  assert.equal(prefText4(undefined, "A", "B"), "未回答");
  assert.equal(ratingLabel4(3), "かなり当てはまる");
  assert.equal(ratingLabel4(null), "判断できない");
  assert.equal(ratingLabel4(undefined), "未回答");
});

test("結果の文に、旧版の断定（一晩・何もしない）や点数・確率の言葉を入れない", () => {
  const texts = [];
  for (const st of ["1", "2", "3", "4", "5", "6", "7", "1w", "3w", "incomplete"]) {
    const t = stateText4(st, "A", "B");
    texts.push(t.title, t.body);
  }
  texts.push(DIFFERENT_DIRECTIONS_TEXT4, LEAD_TITLE4.multiple, LEAD_TITLE4.flat);
  for (const t of texts) assert.ok(!/一晩|何もしない|%|確率|信頼度|正確|な人/.test(t), t);
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
