// node tests/engine4.test.mjs
// 24問版（v4。決定 U44「どっち？」の2択）の採点（js/engine4.js）。仕様：docs/diagnosis-v4.md §5・§6
//  - 値の読み方：1（A）・−1（B）だけ。不正な値は未回答。判断できない（null）と未回答（キーなし）を分ける
//  - 領域の状態の表：A強・A寄り・まんなか・B寄り・B強・incomplete（答えた数が2より少ない）。A の割合（100・67・50・33・0）
//  - 違いの印：U と、同じ向きの P・N が逆のときだけ。本文の後ろに1文
//  - 主軸と補足の並べ方（強 → 寄り → 答えた数 → 領域の番号）、候補が無いときの見出し（flat・none）
//  - 文：状態の見出しと本文。旧版の断定・点数・確率の言葉を入れない
import assert from "node:assert/strict";
import {
  valueOf, validValue4, isAnswer4, classifyDomain4, differentDirections4, domainOf, computeResult4, rankCandidates4,
  stateText4, domainText4, leadSide4, strength4, CANDIDATE_STATES4, LEAD_TITLE4, DIFFERENT_DIRECTIONS_TEXT4, STATE_LABEL4, DOMAIN_IDS4,
} from "../js/engine4.js";
import { QUESTION_ORDER4 } from "../js/data/questions4.js";

let fail = 0, pass = 0;
function test(name, fn) {
  try { fn(); pass++; console.log("OK   " + name); }
  catch (e) { fail++; console.log("FAIL " + name + "\n  " + (e.stack || e).toString().split("\n").slice(0, 6).join("\n  ")); }
}

const ans = (v) => (v === null ? { status: "unknown", value: null } : { status: "answered", value: v });
/** "A" → 1、"B" → −1、"?" → 判断できない、"-" → 未回答 */
const V = { A: 1, B: -1, "?": null };
/** 領域ごとの "UPN"（例 "AAB"・"A?-"）から answers */
function answersOf(spec) {
  const out = {};
  for (const [d, s] of Object.entries(spec)) {
    ["U", "P", "N"].forEach((k, i) => { if (s[i] !== "-") out[`${k}${d}`] = ans(V[s[i]]); });
  }
  return out;
}
const all = (s, over = {}) => answersOf(Object.fromEntries(DOMAIN_IDS4.map((d) => [d, over[d] ?? s])));

// ---------------------------------------------------------------- 値の読み方
test("valueOf：1・−1 だけ読む。判断できないは null、未回答・不正な値は undefined", () => {
  const a = {
    U1: ans(1), P1: ans(-1), N1: ans(null),
    U2: { status: "answered", value: 0 }, P2: { status: "answered", value: 2 }, N2: { status: "answered", value: "1" },
    U3: { status: "answered", value: NaN }, P3: { status: "unknown", value: 1 }, N3: 1,
  };
  assert.equal(valueOf(a, "U1"), 1);
  assert.equal(valueOf(a, "P1"), -1);
  assert.equal(valueOf(a, "N1"), null);
  for (const id of ["U2", "P2", "N2", "U3", "P3", "N3", "U4"]) assert.equal(valueOf(a, id), undefined, id);
  assert.equal(valueOf(null, "U1"), undefined);
  assert.equal(validValue4("XX", 1), false);
  assert.deepEqual([1, -1, 0, 2, "1", null, true].map(isAnswer4), [true, true, false, false, false, false, false]);
});

// ---------------------------------------------------------------- 領域の状態の表
// [U・P・N, 状態, n, a, b, share, differentDirections]
const TABLE = [
  ["AAA", "strongA", 3, 3, 0, 100, false],
  ["AA?", "strongA", 2, 2, 0, 100, false],
  ["?AA", "strongA", 2, 2, 0, 100, false],
  ["AAB", "leanA", 3, 2, 1, 67, false],
  ["ABA", "leanA", 3, 2, 1, 67, false],
  ["BAA", "leanA", 3, 2, 1, 67, true],     // 普段は B、場面は2つとも A
  ["AB?", "mid", 2, 1, 1, 50, false],
  ["?AB", "mid", 2, 1, 1, 50, false],
  ["ABB", "leanB", 3, 1, 2, 33, true],     // 普段は A、場面は2つとも B
  ["BAB", "leanB", 3, 1, 2, 33, false],
  ["BBA", "leanB", 3, 1, 2, 33, false],
  ["BBB", "strongB", 3, 0, 3, 0, false],
  ["B?B", "strongB", 2, 0, 2, 0, false],
  ["A??", "incomplete", 1, 1, 0, 100, false],
  ["??B", "incomplete", 1, 0, 1, 0, false],
  ["???", "incomplete", 0, 0, 0, null, false],
  ["A-B", "mid", 2, 1, 1, 50, false],      // 未回答も数えない（ふつうは結果が出ない。保存が壊れたときだけ）
  ["---", "incomplete", 0, 0, 0, null, false],
];

test("領域の状態の表（A強・A寄り・まんなか・B寄り・B強・incomplete）。A の割合は 100・67・50・33・0", () => {
  for (const [s, state, n, a, b, share, dd] of TABLE) {
    const dom = domainOf(answersOf({ 1: s }), 1);
    assert.deepEqual([dom.state, dom.n, dom.a, dom.b, dom.share, dom.differentDirections], [state, n, a, b, share, dd], s);
  }
  assert.deepEqual(Object.keys(STATE_LABEL4), ["strongA", "leanA", "mid", "leanB", "strongB", "incomplete"]);
  assert.equal(classifyDomain4(0, 0), "incomplete");
  assert.equal(classifyDomain4(1, 0), "incomplete", "答えた数が2より少ない");
});

test("違いの印：U があり、P と N が両方あって同じ向きで、U と逆のときだけ", () => {
  assert.equal(differentDirections4(-1, 1, 1), true);
  assert.equal(differentDirections4(1, -1, -1), true);
  assert.equal(differentDirections4(1, 1, 1), false);
  assert.equal(differentDirections4(1, -1, 1), false, "P と N が違う向き");
  assert.equal(differentDirections4(null, 1, 1), false, "U が判断できない");
  assert.equal(differentDirections4(-1, 1, null), false, "N が判断できない");
  assert.equal(differentDirections4(undefined, 1, 1), false);
});

test("domainOf：3問の答え（picks）と、判断できない（unknown）・未回答（unanswered）を分けた missing", () => {
  const dom = domainOf(answersOf({ 4: "A?-" }), 4);
  assert.deepEqual(dom.picks, { U: "A", P: "unknown", N: "unanswered" });
  assert.deepEqual(dom.missing, [{ id: "P4", status: "unknown" }, { id: "N4", status: "unanswered" }]);
  assert.equal(dom.state, "incomplete");
  assert.equal(dom.domain, 4);
});

// ---------------------------------------------------------------- 結果
test("computeResult4：形（domains・主軸・補足・lead・counts）。confidence と組み合わせは作らない", () => {
  const r = computeResult4(all("AAA", { 3: "A??" }));
  assert.equal(r.diagnosisVersion, "v4");
  assert.equal(r.questionBankVersion, "v4-24-dotchi-2026-10-21");
  assert.deepEqual(Object.keys(r.domains).map(Number), DOMAIN_IDS4);
  assert.equal(r.lead, "primary");
  assert.deepEqual(r.completeDomainIds, [1, 2, 4, 5, 6, 7, 8]);
  assert.deepEqual(r.counts, { answered: 22, unknown: 2, unanswered: 0 });
  for (const k of ["confidence", "combos", "patternIds", "traits"]) assert.ok(!(k in r), k);
  // 毎回同じ答えから同じ結果
  assert.deepEqual(computeResult4(all("AAA", { 3: "A??" })), r);
});

test("主軸と補足の並べ方：強 → 寄り、同じなら答えた数が多い方、さらに同じなら領域の番号順。まんなか・incomplete は候補にしない", () => {
  // 1 寄り(3問)・2 強(2問)・3 まんなか・4 強(3問)・5 寄り(3問)・6 incomplete・7 強(3問)・8 強(2問)
  const r = computeResult4(answersOf({ 1: "AAB", 2: "BB?", 3: "AB?", 4: "BBB", 5: "ABA", 6: "A??", 7: "AAA", 8: "A?A" }));
  assert.deepEqual(rankCandidates4(r.domains).map((x) => x.domain), [4, 7, 2, 8, 1, 5]);
  assert.equal(r.primaryDomainId, 4);
  assert.deepEqual(r.supportingDomainIds, [7, 2]);
  assert.deepEqual([...CANDIDATE_STATES4], ["strongA", "leanA", "leanB", "strongB"]);
  assert.deepEqual(["strongA", "leanA", "mid", "leanB", "strongB", "incomplete"].map(leadSide4), ["A", "A", null, "B", "B", null]);
  assert.deepEqual(["strongA", "leanA", "mid", "leanB", "strongB", "incomplete"].map(strength4), [2, 1, 0, 1, 2, 0]);
});

test("候補が無いとき：状態の出た領域があれば flat『今回の回答では、片側に強く寄らない傾向』、どれも incomplete なら none", () => {
  const flat = computeResult4(all("AB?"));
  assert.equal(flat.lead, "flat");
  assert.equal(flat.primaryDomainId, null);
  assert.deepEqual(flat.supportingDomainIds, []);
  assert.equal(LEAD_TITLE4.flat, "今回の回答では、片側に強く寄らない傾向");
  const mixed = computeResult4(all("A??", { 5: "AB?" }));
  assert.equal(mixed.lead, "flat");
  const none = computeResult4(all("???"));
  assert.equal(none.lead, "none");
  assert.deepEqual(none.completeDomainIds, []);
  assert.deepEqual(none.counts, { answered: 0, unknown: 24, unanswered: 0 });
  // 1つでも強か寄りがあれば primary
  assert.equal(computeResult4(all("AB?", { 6: "BBA" })).primaryDomainId, 6);
});

// ---------------------------------------------------------------- 文
test("状態の見出しと本文（A・B は傾向の名前）。違いの印があるときは本文の後ろに1文", () => {
  const T = (s, d = 1) => domainText4(domainOf(answersOf({ [d]: s }), d));
  assert.deepEqual(T("AAA"), { title: "「向き合う」を選びやすい", body: "3問とも「向き合う」を選びました。" });
  assert.deepEqual(T("A?A"), { title: "「向き合う」を選びやすい", body: "2問とも「向き合う」を選びました。" });
  assert.deepEqual(T("AAB"), { title: "「向き合う」寄り", body: "3問のうち2問で「向き合う」を選びました。" });
  assert.deepEqual(T("AB?"), { title: "どちらか一方には寄らない", body: "「向き合う」と「距離を取る」を同じ数だけ選びました。" });
  assert.deepEqual(T("BAB", 2), { title: "「熟考」寄り", body: "3問のうち2問で「熟考」を選びました。" });
  assert.deepEqual(T("BBB", 2), { title: "「熟考」を選びやすい", body: "3問とも「熟考」を選びました。" });
  assert.deepEqual(T("ABB", 3), { title: "「待つ」寄り", body: `3問のうち2問で「待つ」を選びました。${DIFFERENT_DIRECTIONS_TEXT4}` });
  assert.equal(DIFFERENT_DIRECTIONS_TEXT4, "普段の自分と、場面で選んだ行動に違いがありました。");
  assert.deepEqual(T("A??"), { title: "この領域はまだ分かりません", body: "判断できない問が多いため、この領域は出していません。" });
  assert.equal(stateText4("leanB", "A", "B", { n: 3, b: 2 }).title, "「B」寄り");
  assert.equal(domainText4({ domain: 99 }), null);
});

test("結果の文に、旧版の断定（一晩・何もしない）や点数・確率・評価の言葉を入れない", () => {
  const states = ["strongA", "leanA", "mid", "leanB", "strongB", "incomplete"];
  for (const st of states) {
    for (const dd of [false, true]) {
      const t = stateText4(st, "向き合う", "距離を取る", { n: 3, a: 2, b: 1, differentDirections: dd });
      const s = t.title + t.body;
      assert.ok(!/一晩|何もしない|点|確率|%|％|正確|信頼|な人|べき/.test(s), s);
    }
  }
});

test("24問すべて未回答でも落ちない（どれも incomplete）", () => {
  const r = computeResult4({});
  assert.equal(r.lead, "none");
  assert.deepEqual(r.counts, { answered: 0, unknown: 0, unanswered: QUESTION_ORDER4.length });
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
