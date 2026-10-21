// node tests/result_copy4.test.mjs
// 24問版（v4）の結果の文（持ち主の原稿の形。決定 U46）。仕様：docs/diagnosis-v4.md §6
//  - js/data/result_copy4.js：72本（8領域×9状態）・16の補足と一言とテーマ・テーマの組・特別の組・全体の分岐・向きの違い・未回答の文の数と形
//  - js/result_copy4.js：原稿の状態への当てはめ（U・P・N の答え〔A・B・判断できない・未回答〕の 64 通り全部）、主軸の並び、
//    本文と一言、補足（テーマの重なり・同じ組は飛ばす）、字数で補足を外す、特別の組 PAIR-7B-8B、主軸が無いとき（hold・none・mixed）、最初の1文
//  - 出力の文は原稿の写しの文だけで、中の ID（B1-1・PAIR・テーマの名前）が入らないこと
//  - js/ui/four_store.js の review4（回答を見直す：答えを消さずに1問目へ、24問目まで進むと完了に戻る）
//  - app/js/result_copy_version.js（?rc=u44 で前の形）と、それに合わせた絵（axis_art.js の heroArt4）・ホームのカード（summary4.js の copyCard4）
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  RESULT_COPY_VERSION4, COPY_STATES4, DOMAIN_COPY4, SIDE_COPY4, THEME_GROUPS4, PAIR_7B_8B, OVERALL_COPY4,
  DIFFERENT_DIRECTIONS_COPY4, UNANSWERED_COPY4, ACTION_LEAD4, BREAKDOWN_LABEL4, REVIEW_LABEL4,
} from "../js/data/result_copy4.js";
import {
  resultCopy4, copyStateOf4, copyStatesOf4, primaryOf4, claimTagsOf4, sameTheme4, domainCopy4, copyChars4, firstSentence4,
  COPY_MAX_CHARS4, copySide4,
} from "../js/result_copy4.js";
import { computeResult4, domainOf } from "../js/engine4.js";
import { QUESTION_ORDER4, TOTAL4 } from "../js/data/questions4.js";
import { store4, start4, answer4, back4, review4, useStorage4, restore4, STORAGE_KEY4 } from "../js/ui/four_store.js";
import { DEFAULT_RESULT_COPY, rcFromSearch, resultCopyVersion, isCopyResult } from "../app/js/result_copy_version.js";
import { heroArt4, heroArt, slotMarks } from "../app/js/axis_art.js";
import { copyOf4, copyCard4 } from "../app/js/summary4.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

let fail = 0, pass = 0;
function test(name, fn) {
  try { fn(); pass++; console.log("OK   " + name); }
  catch (e) { fail++; console.log("FAIL " + name + "\n  " + (e.stack || e).toString().split("\n").slice(0, 6).join("\n  ")); }
}

const V = { A: 1, B: -1, "?": null };
const ans = (v) => (v === null ? { status: "unknown", value: null } : { status: "answered", value: v });
/** 領域ごとの "UPN"（"A"・"B"・"?"＝判断できない・"-"＝未回答）から結果 */
function result4Of(spec) {
  const answers = {};
  for (const [d, x] of Object.entries(spec)) {
    ["U", "P", "N"].forEach((k, i) => { if (x[i] !== "-") answers[`${k}${d}`] = ans(V[x[i]]); });
  }
  return computeResult4(answers);
}
const all8 = (x, over = {}) => result4Of(Object.fromEntries([1, 2, 3, 4, 5, 6, 7, 8].map((d) => [d, over[d] ?? x])));

// ---------------------------------------------------------------- データ
test("データ：72本（8領域×9状態）。id は B{d}-{状態}、題と本文は空でない", () => {
  assert.equal(RESULT_COPY_VERSION4, "result-v4.1");
  assert.deepEqual([...COPY_STATES4], ["1", "2", "3", "4", "5", "6", "7", "1w", "3w"]);
  assert.deepEqual(Object.keys(DOMAIN_COPY4).map(Number), [1, 2, 3, 4, 5, 6, 7, 8]);
  let n = 0;
  for (const d of [1, 2, 3, 4, 5, 6, 7, 8]) {
    assert.deepEqual(Object.keys(DOMAIN_COPY4[d]).sort(), [...COPY_STATES4].sort());
    for (const st of COPY_STATES4) {
      const c = DOMAIN_COPY4[d][st];
      assert.equal(c.id, `B${d}-${st}`);
      assert.ok(c.title.length >= 8 && c.title.endsWith("。"), c.id);
      assert.ok(c.body.length >= 80, c.id);
      n++;
    }
  }
  assert.equal(n, 72);
  // 原稿のまま（例を3つ。Markdown のエスケープは外してある）
  assert.equal(DOMAIN_COPY4[1][1].title, "話して、ふたりの間をほどいていく。");
  assert.equal(DOMAIN_COPY4[7]["3w"].body, "今回の場面では、目の前の一件に絞るほうを少し選びやすいようです。背景を考えないという意味ではありません。最初に扱う話を小さくできることには、ふたりで同じところから話し始めやすいよさがあります。");
  assert.ok(DOMAIN_COPY4[5][1].body.startsWith("「どうしてそうなったのか」が分からないままでは、"));
});

test("データ：16の補足と一言とテーマ（1A〜8B）・テーマの組4つ・特別の組・全体の分岐・向きの違い・未回答の文", () => {
  const keys = [1, 2, 3, 4, 5, 6, 7, 8].flatMap((d) => [`${d}A`, `${d}B`]);
  assert.deepEqual(Object.keys(SIDE_COPY4), keys);
  const themes = keys.map((k) => SIDE_COPY4[k].theme);
  assert.equal(new Set(themes).size, 16);
  for (const k of keys) {
    const x = SIDE_COPY4[k];
    assert.match(x.theme, /^[a-z]+(_[a-z]+)+$/);
    assert.ok(x.bridge.endsWith("。"), k);
    assert.ok(!/[「」]/.test(x.action) && x.action.length >= 15, `${k} の一言は「」を付けずに持つ`);
  }
  assert.equal(SIDE_COPY4["1A"].theme, "talk_now");
  assert.equal(SIDE_COPY4["1A"].action, "話したいことがあるんだけど、今少し話せる？");
  assert.equal(SIDE_COPY4["8B"].theme, "restore_closeness");
  assert.deepEqual(THEME_GROUPS4.map((g) => [...g]), [
    ["talk_now", "respond_now", "check_contact"], ["pause_contact", "pause_think", "wait_contact"],
    ["show_feelings", "need_empathy"], ["need_reasons", "need_solution"],
  ]);
  for (const g of THEME_GROUPS4) for (const t of g) assert.ok(themes.includes(t), t);
  assert.equal(PAIR_7B_8B.id, "PAIR-7B-8B");
  assert.equal(PAIR_7B_8B.title, "今の一件をほどいて、いつものふたりに戻る。");
  assert.equal(PAIR_7B_8B.paragraphs.length, 2);
  assert.equal(PAIR_7B_8B.action, "普通に話せてうれしい。この件で、まだ話したいことはある？");
  assert.equal(OVERALL_COPY4.mixed.title, "ひとつの型に、収まらなくていい。");
  assert.equal(OVERALL_COPY4.hold.title, "いまの答えを、そのまま大切にする。");
  assert.equal(OVERALL_COPY4.none.title, "答えがそろうまで、決めなくていい。");
  assert.equal(OVERALL_COPY4.mixed.action, "今は、どんな話し方ならお互いに話しやすそう？");
  assert.equal(OVERALL_COPY4.hold.action, OVERALL_COPY4.mixed.action);
  assert.equal(OVERALL_COPY4.none.action, undefined, "答えがそろわないときは一言を出さない");
  assert.equal(DIFFERENT_DIRECTIONS_COPY4.title, "普段の感覚と、その場の選び方は違ってもいい。");
  assert.equal(UNANSWERED_COPY4.title, "まだ、決めなくていいところもある。");
  assert.equal(ACTION_LEAD4, "たとえば、こんな一言から。");
  assert.equal(BREAKDOWN_LABEL4, "回答の内訳を見る");
  assert.equal(REVIEW_LABEL4, "回答を見直す");
});

test("データ：Markdown のエスケープや、リポジトリに書かない言葉が残っていない", () => {
  const src = readFileSync(join(ROOT, "js/data/result_copy4.js"), "utf8");
  for (const bad of ["\\<", "\\_", "\\*", "\\.", "**", "http"]) {
    assert.ok(!src.includes(bad), `「${bad}」が入っている`);
  }
  const texts = [];
  for (const d of [1, 2, 3, 4, 5, 6, 7, 8]) for (const st of COPY_STATES4) texts.push(DOMAIN_COPY4[d][st].title, DOMAIN_COPY4[d][st].body);
  for (const x of Object.values(SIDE_COPY4)) texts.push(x.bridge, x.action);
  for (const t of texts) assert.ok(!/[\\*_<>]/.test(t), t);
});

// ---------------------------------------------------------------- 状態への当てはめ（64通り）
/** 設計の表どおりの期待（engine4 を使わずに、答えの文字から決める） */
function expectedState(x) {
  const vals = [...x].filter((c) => c === "A" || c === "B");
  const n = vals.length, a = vals.filter((c) => c === "A").length, b = n - a;
  if (n < 2) return "incomplete";
  const [u, p, q] = x;
  if ((u === "A" || u === "B") && (p === "A" || p === "B") && p === q && u !== p) return "7dd";
  if (n === 3) return a === 3 ? "1" : b === 3 ? "3" : a === 2 ? "2" : "4";
  return a === 2 ? "1w" : b === 2 ? "3w" : "7";
}

test("原稿の状態への当てはめ：U・P・N の答え（A・B・判断できない・未回答）の 64 通りすべて", () => {
  const P = ["A", "B", "?", "-"];
  const seen = new Set();
  for (const u of P) for (const p of P) for (const q of P) {
    const x = u + p + q;
    const r = result4Of({ 1: x });
    const got = copyStateOf4(r.domains[1]);
    assert.equal(got, expectedState(x), x);
    seen.add(got);
  }
  assert.deepEqual([...seen].sort(), ["1", "1w", "2", "3", "3w", "4", "7", "7dd", "incomplete"], "5・6は2択では出ない");
  // 代表の例
  const S = (x) => copyStateOf4(result4Of({ 1: x }).domains[1]);
  assert.equal(S("AAB"), "2"); assert.equal(S("ABA"), "2"); assert.equal(S("BAA"), "7dd");
  assert.equal(S("BBA"), "4"); assert.equal(S("BAB"), "4"); assert.equal(S("ABB"), "7dd");
  assert.equal(S("AB?"), "7", "A1・B1・判断できない1 は一つにまとめない");
  assert.equal(S("A?A"), "1w"); assert.equal(S("-BB"), "3w"); assert.equal(S("A??"), "incomplete");
  // 形の合わない値は incomplete
  assert.equal(copyStateOf4(null), "incomplete");
  assert.equal(copyStateOf4({ a: 4, b: 0 }), "incomplete");
  assert.equal(copyStateOf4({ a: "2", b: 1 }), "incomplete");
  assert.deepEqual(copyStatesOf4(null), { 1: "incomplete", 2: "incomplete", 3: "incomplete", 4: "incomplete", 5: "incomplete", 6: "incomplete", 7: "incomplete", 8: "incomplete" });
});

test("選ばれた側：1・2・1w は A、3・4・3w は B、ほかは null", () => {
  assert.deepEqual(["1", "2", "1w", "3", "4", "3w", "5", "6", "7", "7dd", "incomplete"].map(copySide4), ["A", "A", "A", "B", "B", "B", null, null, null, null, null]);
});

// ---------------------------------------------------------------- 主軸
test("主軸の並び：1／3（3問とも同じ側）→ 2／4 → 1w／3w → 領域の番号", () => {
  const P = (spec) => primaryOf4(copyStatesOf4(result4Of(spec)));
  assert.deepEqual(P({ 1: "AA?", 2: "AAB", 3: "BBB" }), { domain: 3, state: "3", side: "B" });
  assert.deepEqual(P({ 1: "AA?", 2: "AAB", 5: "BBA" }), { domain: 2, state: "2", side: "A" });
  assert.deepEqual(P({ 1: "AA?", 2: "?BB", 3: "BAA" }), { domain: 1, state: "1w", side: "A" }, "7dd は候補にしない");
  assert.deepEqual(P({ 4: "BBB", 6: "AAA" }), { domain: 4, state: "3", side: "B" });
  assert.equal(P({ 1: "AB?", 2: "BAA", 3: "???" }), null);
  // engine4 の主軸（強 → 寄り → 答えた数）とは並びが違うことがある：2問とも A（1w）は、3問のうち2問（2）より後
  const r = result4Of({ 1: "AA?", 2: "AAB" });
  assert.equal(r.primaryDomainId, 1, "engine4.js の主軸（前の形で使う）は変えない");
  assert.equal(resultCopy4(r).primaryDomain, 2);
});

test("本文と一言：主軸の領域の B{d}-{状態}、一言は主軸の選ばれた側。claimTags", () => {
  const c = resultCopy4(result4Of({ 1: "AAA" }));
  assert.equal(c.kind, "primary");
  assert.equal(c.copyId, "B1-1");
  assert.equal(c.copyVersion, "result-v4.1");
  assert.equal(c.primaryDomain, 1);
  assert.equal(c.side, "A");
  assert.equal(c.title, DOMAIN_COPY4[1][1].title);
  assert.deepEqual([...c.paragraphs], [DOMAIN_COPY4[1][1].body]);
  assert.equal(c.action, SIDE_COPY4["1A"].action);
  assert.deepEqual([...c.claimTags], ["talk_now"]);
  const w = resultCopy4(result4Of({ 7: "-BB" }));
  assert.deepEqual([w.copyId, w.side, w.action], ["B7-3w", "B", SIDE_COPY4["7B"].action]);
  assert.deepEqual([...w.claimTags], ["focus_event"]);
  const two = resultCopy4(result4Of({ 6: "BBA" }));
  assert.deepEqual([two.copyId, two.side], ["B6-4", "B"]);
  assert.deepEqual([...two.claimTags], ["lead_process", "adjust_process"], "2・4 は A と B の両方のテーマ");
  assert.deepEqual(claimTagsOf4(3, "5"), ["check_contact", "wait_contact"]);
  assert.deepEqual(claimTagsOf4(3, "7"), []);
  assert.deepEqual(claimTagsOf4(3, "incomplete"), []);
});

// ---------------------------------------------------------------- 補足
test("補足：主軸以外で 1・2・3・4 の領域を主軸と同じ並びで見て、最初に合う1つ（1w・3w・7・7dd からは作らない）", () => {
  const c = resultCopy4(result4Of({ 1: "AAA", 6: "AAB", 4: "?BB", 8: "BAA" }));
  assert.equal(c.bridgeDomain, 6);
  assert.equal(c.bridge, SIDE_COPY4["6A"].bridge);
  const none = resultCopy4(result4Of({ 1: "AAA", 4: "?BB", 5: "AB?", 8: "BAA" }));
  assert.equal(none.bridge, null);
  assert.equal(none.bridgeDomain, null);
  // 3問とも同じ側（tier 0）が、2／4 より先
  const t = resultCopy4(result4Of({ 1: "AAA", 6: "AAB", 8: "BBB" }));
  assert.equal(t.bridgeDomain, 8);
});

test("補足：同じテーマ・同じ組なら飛ばす（すぐに話す・間を置く・気持ち・具体策の4組）", () => {
  // 主軸 1A（talk_now）。2A respond_now・3A check_contact は同じ組 → 飛ばして 4A
  let c = resultCopy4(all8("AAA"));
  assert.equal(c.bridgeDomain, 4);
  assert.equal(c.bridge, SIDE_COPY4["4A"].bridge);
  // 主軸 1B（pause_contact）。2B pause_think・3B wait_contact は同じ組 → 4B（hold_feelings はどの組にも入らない）
  c = resultCopy4(all8("BBB"));
  assert.equal(c.bridgeDomain, 4);
  // 主軸 4A（show_feelings）。5B need_empathy は同じ組 → 飛ばして 6A
  c = resultCopy4(result4Of({ 4: "AAA", 5: "BBB", 6: "AAA" }));
  assert.equal(c.bridgeDomain, 6);
  // 主軸 5A（need_reasons）。8A need_solution は同じ組
  c = resultCopy4(result4Of({ 5: "AAA", 8: "AAA" }));
  assert.equal(c.bridge, null);
  // 主軸が 2（A と B の両方のテーマ）：1A（talk_now）と同じ組の respond_now、1B と同じ組の pause_think を持つ → 1 も 3 も飛ばす
  c = resultCopy4(result4Of({ 2: "AAB", 1: "BBB", 3: "AAA", 7: "AAA" }));
  assert.equal(c.primaryDomain, 1, "3問とも同じ側の 1 が主軸");
  c = resultCopy4(result4Of({ 2: "AAB", 1: "BBA", 3: "BBA", 7: "ABA" }));
  assert.equal(c.primaryDomain, 1);
  assert.equal(c.copyId, "B1-4");
  assert.equal(c.bridgeDomain, 7, "2A（respond_now）は 1 の talk_now と同じ組、3B（wait_contact）は pause_contact と同じ組 → 7A");
  assert.ok(sameTheme4("respond_now", ["talk_now"]));
  assert.ok(sameTheme4("talk_now", ["talk_now"]));
  assert.ok(!sameTheme4("hold_feelings", ["show_feelings"]), "hold_feelings はどの組にも入らない");
  assert.ok(!sameTheme4("focus_event", ["restore_closeness"]));
  assert.ok(!sameTheme4(null, ["talk_now"]));
});

test("字数：本文＋補足＋一言が上限を超えると補足を外す（本文は切らない）。今の原稿では 260 字を超える組は無い", () => {
  const r = all8("AAA");
  const c = resultCopy4(r);
  assert.ok(c.bridge);
  const n = copyChars4(c);
  assert.equal(n, [...c.paragraphs[0]].length + [...c.bridge].length + [...c.action].length);
  const cut = resultCopy4(r, { maxChars: n - 1 });
  assert.equal(cut.bridge, null);
  assert.equal(cut.bridgeDomain, null);
  assert.deepEqual([...cut.paragraphs], [...c.paragraphs], "本文はそのまま");
  assert.equal(resultCopy4(r, { maxChars: n }).bridge, c.bridge);
  assert.equal(COPY_MAX_CHARS4, 260);
  let max = 0;
  for (const d of [1, 2, 3, 4, 5, 6, 7, 8]) for (const st of ["1", "2", "3", "4", "1w", "3w"]) for (const e of Object.keys(SIDE_COPY4)) {
    const side = copySide4(st);
    max = Math.max(max, copyChars4({ paragraphs: [DOMAIN_COPY4[d][st].body], bridge: SIDE_COPY4[e].bridge, action: SIDE_COPY4[`${d}${side}`].action }));
  }
  assert.ok(max <= 260, `いちばん長い組 ${max} 字`);
});

// ---------------------------------------------------------------- 特別の組
test("特別の組 PAIR-7B-8B：7 と 8 がどちらも B 側（3 か 4）で、主軸が 7 か 8 のときだけ。補足なし", () => {
  const spec = { 1: "AB?", 2: "AB?", 7: "BBB", 8: "BBA" };
  const c = resultCopy4(result4Of(spec));
  assert.equal(c.kind, "pair");
  assert.equal(c.copyId, "PAIR-7B-8B");
  assert.equal(c.primaryDomain, 7);
  assert.equal(c.side, "B");
  assert.equal(c.title, PAIR_7B_8B.title);
  assert.deepEqual([...c.paragraphs], [...PAIR_7B_8B.paragraphs]);
  assert.equal(c.action, PAIR_7B_8B.action);
  assert.equal(c.bridge, null);
  // 主軸が 8（7 は 4、8 は 3 → 3問とも B の 8 が先）
  assert.equal(resultCopy4(result4Of({ 7: "BBA", 8: "BBB" })).primaryDomain, 8);
  assert.equal(resultCopy4(result4Of({ 7: "BBA", 8: "BBB" })).kind, "pair");
  // ほかの領域が主軸なら、ふつうの原稿（補足の候補に 7・8 も入る）
  const o = resultCopy4(result4Of({ 1: "AAA", 7: "BBB", 8: "BBB" }));
  assert.equal(o.kind, "primary");
  assert.equal(o.copyId, "B1-1");
  // 8 が 3w（2問だけ）・7dd・A 側なら特別の組にしない
  assert.equal(resultCopy4(result4Of({ 7: "BBB", 8: "?BB" })).copyId, "B7-3");
  assert.equal(resultCopy4(result4Of({ 7: "BBB", 8: "ABB" })).copyId, "B7-3");
  assert.equal(resultCopy4(result4Of({ 7: "BBB", 8: "AAB" })).copyId, "B7-3");
});

// ---------------------------------------------------------------- 主軸が無いとき
test("主軸が無いとき：答えがそろった領域はある（7・7dd だけ）→ hold、1つも無い → none（一言なし）", () => {
  const h = resultCopy4(all8("AB?", { 3: "BAA" }));
  assert.deepEqual([h.kind, h.copyId, h.title, h.paragraphs[0], h.action, h.bridge, h.primaryDomain, h.side],
    ["hold", "OVERALL-HOLD", OVERALL_COPY4.hold.title, OVERALL_COPY4.hold.body, OVERALL_COPY4.hold.action, null, null, null]);
  const n = resultCopy4(all8("???"));
  assert.deepEqual([n.kind, n.copyId, n.title, n.paragraphs[0], n.action, n.bridge], ["none", "OVERALL-NONE", OVERALL_COPY4.none.title, OVERALL_COPY4.none.body, null, null]);
  assert.equal(resultCopy4(all8("A??")).kind, "none", "どの領域も答えが1問以下");
  assert.equal(resultCopy4(null).kind, "none");
});

test("状態5の領域があるとき（2択では起きない。分岐だけ確かめる）→ mixed。本文は番号がいちばん小さい B{d}-5", () => {
  // copyStateOf4 は 5 を返さないので、states を作るところだけ差し替えた結果で確かめる：primaryOf4 は 5 を候補にしない
  assert.equal(primaryOf4({ 1: "5", 2: "7", 3: "5", 4: "incomplete", 5: "7", 6: "7", 7: "7", 8: "7" }), null);
  assert.deepEqual(domainCopy4(3, "5"), { id: "B3-5", title: DOMAIN_COPY4[3][5].title, body: DOMAIN_COPY4[3][5].body });
});

test("領域ごとの文（標準の画面には並べない）：7dd は専用の文、incomplete は未回答の文", () => {
  assert.deepEqual(domainCopy4(2, "7dd"), { id: "B2-7dd", ...DIFFERENT_DIRECTIONS_COPY4 });
  assert.deepEqual(domainCopy4(2, "incomplete"), { id: "B2-incomplete", ...UNANSWERED_COPY4 });
  assert.equal(domainCopy4(2, "1w").id, "B2-1w");
  assert.equal(domainCopy4(9, "1"), null);
  assert.equal(domainCopy4(1, "8"), null);
});

// ---------------------------------------------------------------- 出力に中の ID を入れない
test("出力の文（題・本文・補足・一言）は原稿の写しの文だけで、中の ID・テーマの名前は入らない", () => {
  const known = new Set();
  for (const d of [1, 2, 3, 4, 5, 6, 7, 8]) for (const st of COPY_STATES4) known.add(DOMAIN_COPY4[d][st].title).add(DOMAIN_COPY4[d][st].body);
  for (const x of Object.values(SIDE_COPY4)) known.add(x.bridge).add(x.action);
  for (const x of [...PAIR_7B_8B.paragraphs, PAIR_7B_8B.title, PAIR_7B_8B.action]) known.add(x);
  for (const o of Object.values(OVERALL_COPY4)) for (const k of ["title", "body", "action"]) if (o[k]) known.add(o[k]);
  const P = ["A", "B", "?"];
  const specs = [all8("AAA"), all8("BBB"), all8("AB?"), all8("???"), result4Of({ 7: "BBB", 8: "BBA" })];
  for (const x of P) for (const y of P) for (const z of P) specs.push(all8(x + y + z), all8("AB?", { 3: x + y + z, 6: z + y + x }));
  for (const r of specs) {
    const c = resultCopy4(r);
    for (const t of [c.title, ...c.paragraphs, c.bridge, c.action].filter(Boolean)) {
      assert.ok(known.has(t), `原稿の写しに無い文：${t}`);
      assert.ok(!/B[1-8]-|PAIR|OVERALL|[a-z]_[a-z]|incomplete/.test(t), t);
    }
  }
});

// ---------------------------------------------------------------- 最初の1文
test("最初の1文：。？！ で切る。「」の中では切らない", () => {
  assert.equal(firstSentence4(DOMAIN_COPY4[1][1].body), "気まずいまま話が途切れると、どこか落ち着かないこともあるのではないでしょうか。");
  assert.equal(firstSentence4("「どうして？」と思った。次の文。"), "「どうして？」と思った。");
  assert.equal(firstSentence4("句点の無い文"), "句点の無い文");
  assert.equal(firstSentence4(null), "");
  for (const d of [1, 2, 3, 4, 5, 6, 7, 8]) for (const st of COPY_STATES4) {
    const b = DOMAIN_COPY4[d][st].body;
    const f = firstSentence4(b);
    assert.ok(b.startsWith(f) && f.endsWith("。") && f.length < b.length, `B${d}-${st}`);
  }
});

// ---------------------------------------------------------------- 回答を見直す（four_store.js の review4）
function memory() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: (k) => { m.delete(k); }, _m: m };
}

test("回答を見直す：答えを消さずに1問目へ。答えるたびに次へ進み、24問目に答えると完了に戻る。前へ戻れる", () => {
  const s = memory();
  useStorage4(s);
  restore4();
  start4();
  for (let i = 0; i < TOTAL4; i++) answer4(null);   // 全部「判断できない」
  assert.ok(store4.session.completed);
  assert.equal(resultCopy4(store4.result).kind, "none");
  const before = JSON.stringify(store4.session.answers);
  assert.ok(review4());
  assert.equal(store4.session.completed, false);
  assert.equal(store4.session.currentIndex, 0);
  assert.equal(store4.result, null);
  assert.equal(JSON.stringify(store4.session.answers), before, "答えは消さない");
  assert.equal(JSON.parse(s.getItem(STORAGE_KEY4)).answers[QUESTION_ORDER4[5]].status, "unknown");
  answer4(1);                                        // 1問目を A に
  assert.equal(store4.session.completed, false, "答えがそろっていても、見直しの間は次の問いへ");
  assert.equal(store4.session.currentIndex, 1);
  assert.ok(back4());
  assert.equal(store4.session.currentIndex, 0);
  for (let i = 0; i < TOTAL4; i++) answer4(i === 0 ? 1 : null);
  assert.ok(store4.session.completed);
  assert.equal(store4.session.currentIndex, TOTAL4 - 1);
  assert.equal(store4.result.domains[1].picks.U, "A");
  // 見直しの途中で読み込み直すと、答えがそろっているので完了として読む（保存の形は変えない）
  review4();
  answer4(-1);
  useStorage4(s);
  restore4();
  assert.ok(store4.session.completed);
  assert.equal(store4.result.domains[1].picks.U, "B");
  useStorage4(memory());
  restore4();
  assert.equal(review4(), false, "診断が無ければ何もしない");
  useStorage4(null);
});

// ---------------------------------------------------------------- 出し方の版・絵・ホームのカード
test("出し方の版：既定は v4.1。?rc=u44 で前の形（知らない値は無視）", () => {
  assert.equal(DEFAULT_RESULT_COPY, "v4.1");
  assert.equal(rcFromSearch("?rc=u44"), "u44");
  assert.equal(rcFromSearch("?dv=v4&rc=U44"), "u44");
  assert.equal(rcFromSearch("?rc=v4.1"), "v4.1");
  assert.equal(rcFromSearch("?rc=u45"), null);
  assert.equal(rcFromSearch(""), null);
  assert.equal(resultCopyVersion({ url: null }), "v4.1");
  assert.equal(resultCopyVersion({ url: "u44" }), "u44");
  assert.equal(resultCopyVersion({ url: null, def: "u44" }), "u44", "既定を前の形に戻したとき");
  assert.equal(isCopyResult({ url: null }), true);
  assert.equal(isCopyResult({ url: "u44" }), false);
});

test("いちばん上の絵：既定は結果の文の主軸の、選ばれた側の絵。rc u44 は engine4 の主軸の絵", () => {
  const r = result4Of({ 1: "AA?", 2: "AAB" });
  assert.equal(heroArt4(r).id, "2-a");
  assert.equal(heroArt4(r).key, "2A");
  assert.equal(heroArt(r).id, "2-a", "ホームの上の絵も同じ");
  assert.equal(slotMarks(r).hero, "2-a", "絵の一覧の印も同じ");
  assert.equal(heroArt4(r, { rc: "u44" }).id, "1-a");
  assert.equal(heroArt4(result4Of({ 7: "BBB", 8: "BBA" })).id, "7-b", "特別の組も主軸の絵");
  assert.equal(heroArt4(all8("AB?")), null, "主軸が無ければ絵なし");
  assert.equal(heroArt4(null), null);
});

test("ホームのカードと結果の画面は同じ題（copyOf4・copyCard4）。答えがそろわないときは題だけ", () => {
  const r = all8("AAA");
  assert.equal(copyCard4(r).title, copyOf4(r).title);
  assert.equal(copyCard4(r).sentence, firstSentence4(copyOf4(r).paragraphs[0]));
  const p = result4Of({ 7: "BBB", 8: "BBA" });
  assert.equal(copyCard4(p).title, PAIR_7B_8B.title);
  assert.equal(copyCard4(p).sentence, "一つのすれ違いに過去の話まで重なると、何から話せばいいか困ることもありますよね。");
  assert.deepEqual(copyCard4(all8("???")), { title: OVERALL_COPY4.none.title, sentence: "", kind: "none" });
  assert.equal(copyCard4(null), null);
  assert.equal(copyOf4({ diagnosisVersion: "v3" }), null);
});

test("engine4 の判定・結果の形は変えない（domainOf の形）", () => {
  const r = result4Of({ 1: "BAA" });
  const d = domainOf({ U1: ans(-1), P1: ans(1), N1: ans(1) }, 1);
  assert.deepEqual(r.domains[1], d);
  assert.equal(d.state, "leanA");
  assert.equal(d.differentDirections, true);
  assert.equal(copyStateOf4(d), "7dd");
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
