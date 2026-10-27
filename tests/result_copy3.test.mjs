// node tests/result_copy3.test.mjs
// 三択（80問。v3）の結果も、持ち主の原稿の形に（決定 U49）。仕様：docs/diagnosis-v4.md §6.5・docs/app-screens.md §24
//  - js/result_copy3.js：domainStates3 の状態（9種類）→ 原稿 B{d}-{状態}、null（判定なし）→ 7、値が無い → incomplete
//    主軸・本文・一言・補足・特別の組 PAIR-7B-8B・主軸が無いとき（mixed・hold）が原稿の文になる（答えを流した三択の結果と、状態の表から）
//    三択だけの足し：同じ段の中の並び（強さ → 左右の余裕 → 差 → 番号）、補足は「選んだ側 ≧ 反対側」だけ、PAIR は両方 LB ≧ LA のときだけ
//    出力の文は原稿の写しの文だけで、中の ID が入らない。72本のうち三択から届く文（56本）
//  - app/js/result_copy_version.js の ?rc3=（と ?tc= の読み取りの形）
//  - 同じタイトルを使う所：heroArt・slotMarks（いちばん上の絵）、copyCard3（ホームのカード）、diagnosisRecord（履歴）、shareTextCopy3（シェア）
//  - 三択の安全の1行（safetyDomains3・safetyNote3。領域3・6が状態 "1"）、結果の画面の内訳の1行（countLine3。％を出さない）
// 24問の出力が変わっていないことは tests/result_copy4.test.mjs（変えずに全部通す）
import assert from "node:assert/strict";
import { Session3, drive } from "../js/adaptive3.js";
import { DOMAINS, domainStates3 } from "../js/engine3.js";
import {
  RESULT_COPY_VERSION3, copyStateOf3, copyStatesOf3, rankOf3, resultCopy3, resultCopyFromStates3,
} from "../js/result_copy3.js";
import { resultCopy4, resultCopyFromStates, COPY_MAX_CHARS4 } from "../js/result_copy4.js";
import {
  COPY_STATES4, DOMAIN_COPY4, SIDE_COPY4, PAIR_7B_8B, OVERALL_COPY4, DIFFERENT_DIRECTIONS_COPY4, UNANSWERED_COPY4, THEME_GROUPS4,
} from "../js/data/result_copy4.js";
import {
  DEFAULT_RESULT_COPY3, rc3FromSearch, resultCopy3Version, isCopyResult3, DEFAULT_TYPE_COPY, tcFromSearch, DEFAULT_RESULT_COPY,
} from "../app/js/result_copy_version.js";
import { heroArt, heroArt3copy, slotMarks, AXIS_ART } from "../app/js/axis_art.js";
import { copyOf3, copyCard3, diagnosisRecord, recordDiagnosis, resultKey, isResult3 } from "../app/js/summary.js";
import { useStorage, loadRecords, addRecord } from "../app/js/local.js";
import { shareTextCopy3, shareTextCopy4, SHARE_LEAD } from "../app/js/share.js";
import { safetyDomains3, safetyNote3, SAFETY_NOTE4, SAFETY_NOTE_TAIL4 } from "../app/js/safety.js";
import { countLine3, BREAKDOWN_LEGEND3, BREAKDOWN_NOTE3 } from "../app/js/result.js";
import { typeMarks } from "../app/js/type_catalog.js";

let fail = 0, pass = 0;
function test(name, fn) {
  try { fn(); pass++; console.log("OK   " + name); }
  catch (e) { fail++; console.log("FAIL " + name + "\n  " + (e.stack || e).toString().split("\n").slice(0, 6).join("\n  ")); }
}

const DS = [1, 2, 3, 4, 5, 6, 7, 8];
const T = (d, s) => DOMAINS[d][s];
const memory = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: (k) => { m.delete(k); } };
};

// ---------------------------------------------------------------- 状態の表を作る道具
// 領域ごとに「W の左右の数・A と B の強さ」を決めて、domainStates3 で本当にその状態になる profile3 を作る
const SHAPE = {
  1: { w: [4, 0], L: [80, 20] }, 2: { w: [4, 0], L: [80, 60] }, 3: { w: [0, 4], L: [20, 80] }, 4: { w: [0, 4], L: [60, 80] },
  "1w": { w: [4, 0], L: [50, 30] }, "3w": { w: [0, 4], L: [30, 50] },
  5: { w: [2, 2], L: [80, 80] }, 6: { w: [2, 2], L: [20, 20] }, 7: { w: [2, 2], L: [50, 50] },
  null: { w: [2, 2], L: [80, 20] },   // 左右が拮抗し、強さが「両方強い・両方弱い・どちらかが中」のどれでもない → 判定なし
};
/** spec = { 領域: 状態 | { w: [a, b], L: [LA, LB] } }。書かない領域は状態7 */
function profileOf(spec = {}) {
  const levels = {}, w = {};
  for (const d of DS) {
    const x = Object.hasOwn(spec, d) ? spec[d] : "7";
    const sh = typeof x === "object" && x !== null && !Array.isArray(x) && x.w ? x : SHAPE[x];
    w[d] = { a: sh.w[0], b: sh.w[1] };
    levels[T(d, "a")] = sh.L[0];
    levels[T(d, "b")] = sh.L[1];
  }
  return { levels, w, quality: { ok: true } };
}
const tableOf = (spec) => domainStates3(profileOf(spec));
const resOf = (spec) => ({ version: "v3", states: tableOf(spec), records: [], select: { chosen: [] } });

/** 答えを流した本当の三択の結果（js/adaptive3.js）。policy = { score: {傾向: 数}, wAlt: [交互に答える領域] } */
function session3(policy) {
  const s = new Session3({ adaptive: true, version: "v3" });
  const cnt = {};
  drive(s, (c) => {
    const L = c.question.left.trait, R = c.question.right.trait;
    if (c.question.kind === "W" && (policy.wAlt || []).includes(c.question.domain)) {
      const d = c.question.domain; cnt[d] = (cnt[d] || 0) + 1;
      const t = cnt[d] % 2 === 1 ? T(d, "a") : T(d, "b");
      return L === t ? "left" : "right";
    }
    const sc = policy.score || {};
    return (sc[R] ?? 0) > (sc[L] ?? 0) ? "right" : "left";
  });
  return { ...s.result(), source: { type: "session", name: "あなたの回答" } };
}
const score = (f) => Object.fromEntries(DS.flatMap((d) => { const [a, b] = f(d); return [[T(d, "a"), a], [T(d, "b"), b]]; }));
const REAL = {
  primary: session3({ score: score((d) => [10 + (8 - d), d]) }),
  pair: session3({ score: score((d) => (d >= 7 ? [0, 20] : [5, 1])) }),
  hold: session3({ wAlt: DS, score: score(() => [3, 3]) }),
  mixed: session3({ wAlt: DS, score: score((d) => (d <= 2 ? [10, 10] : [3, 3])) }),
};

// 原稿の写しにある文（出力はこの中の文だけ）
const ALLOWED = new Set();
for (const d of DS) for (const st of COPY_STATES4) { ALLOWED.add(DOMAIN_COPY4[d][st].title); ALLOWED.add(DOMAIN_COPY4[d][st].body); }
for (const x of Object.values(SIDE_COPY4)) { ALLOWED.add(x.bridge); ALLOWED.add(x.action); }
ALLOWED.add(PAIR_7B_8B.title); PAIR_7B_8B.paragraphs.forEach((p) => ALLOWED.add(p)); ALLOWED.add(PAIR_7B_8B.action);
for (const o of Object.values(OVERALL_COPY4)) for (const k of ["title", "body", "action"]) if (o[k]) ALLOWED.add(o[k]);
const THEMES = Object.values(SIDE_COPY4).map((x) => x.theme);
function onlyManuscript(c, label) {
  const texts = [c.title, ...c.paragraphs, c.bridge, c.action].filter((x) => x != null);
  for (const x of texts) {
    assert.ok(ALLOWED.has(x), `${label}：原稿の写しに無い文「${x}」`);
    assert.ok(!/B\d-|PAIR|OVERALL/.test(x), `${label}：中の ID が文に入っている`);
    assert.ok(!THEMES.some((t) => x.includes(t)), `${label}：テーマの名前が文に入っている`);
  }
  assert.ok(!texts.includes(DIFFERENT_DIRECTIONS_COPY4.title) && !texts.includes(UNANSWERED_COPY4.title), `${label}：向きの違い・未回答の文は出さない`);
}

// ---------------------------------------------------------------- 状態の当てはめ
test("copyStateOf3：domainStates3 の9種類はそのまま、null・知らない値は 7、領域の値が無い・形が違えば incomplete", () => {
  for (const s of COPY_STATES4) assert.equal(copyStateOf3({ state: s }), s);
  assert.equal(copyStateOf3({ state: null }), "7", "判定なし → 7（原稿 §7）");
  assert.equal(copyStateOf3({ state: "8" }), "7");
  assert.equal(copyStateOf3({}), "7");
  assert.equal(copyStateOf3(undefined), "incomplete");
  assert.equal(copyStateOf3(null), "incomplete");
  assert.equal(copyStateOf3("1"), "incomplete");
  assert.equal(copyStateOf3([]), "incomplete");
});

test("状態の表の道具：profileOf の形が domainStates3 で本当にその状態になる（null も）", () => {
  for (const s of [...COPY_STATES4, "null"]) {
    const t = tableOf({ 1: s === "null" ? null : s });
    assert.equal(t[1].state, s === "null" ? null : s, `状態 ${s}`);
    assert.equal(copyStatesOf3({ states: t })[1], s === "null" ? "7" : s);
  }
  // 書かない領域は 7
  assert.deepEqual(copyStatesOf3(resOf({})), Object.fromEntries(DS.map((d) => [d, "7"])));
  // r.states でも、表そのものでも読める。形が違えば incomplete だけ（→ 主軸なし・none）
  assert.deepEqual(copyStatesOf3(tableOf({ 2: "3" })), copyStatesOf3(resOf({ 2: "3" })));
  assert.deepEqual(copyStatesOf3(null), Object.fromEntries(DS.map((d) => [d, "incomplete"])));
  assert.equal(resultCopy3(null).kind, "none");
  assert.equal(resultCopy3({ states: {} }).kind, "none", "incomplete だけなら24問と同じ none（三択では起きない）");
});

test("向きの違いの専用の文は使わない：三択の状態7（左右が拮抗）はいつもの B{d}-7（標準の画面には並べない）", () => {
  const c = resultCopy3(resOf({}));
  assert.equal(c.kind, "hold");
  onlyManuscript(c, "全部7");
});

// ---------------------------------------------------------------- 答えを流した本当の三択の結果
test("本当の三択の結果：主軸あり（領域1が状態1）→ B1-1 の題と本文、一言は 1A、補足は領域4（A）の1文", () => {
  const r = REAL.primary;
  assert.equal(r.states[1].state, "1");
  const c = resultCopy3(r);
  assert.equal(c.copyVersion, RESULT_COPY_VERSION3);
  assert.equal(c.copyVersion, "result-v3.1");
  assert.equal(c.kind, "primary");
  assert.equal(c.copyId, "B1-1");
  assert.equal(c.primaryDomain, 1);
  assert.equal(c.side, "A");
  assert.equal(c.title, DOMAIN_COPY4[1][1].title);
  assert.deepEqual([...c.paragraphs], [DOMAIN_COPY4[1][1].body]);
  assert.equal(c.action, SIDE_COPY4["1A"].action);
  // 領域2（2A respond_now）は 1A talk_now と同じ組なので飛ばし、領域4（4A）の1文
  assert.equal(c.bridgeDomain, 4);
  assert.equal(c.bridge, SIDE_COPY4["4A"].bridge);
  assert.deepEqual([...c.claimTags], ["talk_now"]);
  onlyManuscript(c, "primary");
  assert.ok(Object.isFrozen(c));
});

test("本当の三択の結果：特別の組（領域7・8が状態3、主軸が7）→ PAIR-7B-8B の題・本文2段落・一言、補足なし", () => {
  const r = REAL.pair;
  assert.equal(r.states[7].state, "3");
  assert.equal(r.states[8].state, "3");
  const c = resultCopy3(r);
  assert.equal(c.kind, "pair");
  assert.equal(c.copyId, "PAIR-7B-8B");
  assert.equal(c.primaryDomain, 7);
  assert.equal(c.side, "B");
  assert.equal(c.title, PAIR_7B_8B.title);
  assert.deepEqual([...c.paragraphs], [...PAIR_7B_8B.paragraphs]);
  assert.equal(c.action, PAIR_7B_8B.action);
  assert.equal(c.bridge, null);
  onlyManuscript(c, "pair");
});

test("本当の三択の結果：主軸なし（左右が拮抗した領域だけ）→ hold／状態5の領域がある → mixed（本文は番号のいちばん小さい B{d}-5）", () => {
  const h = resultCopy3(REAL.hold);
  assert.equal(h.kind, "hold");
  assert.equal(h.title, OVERALL_COPY4.hold.title);
  assert.deepEqual([...h.paragraphs], [OVERALL_COPY4.hold.body]);
  assert.equal(h.action, OVERALL_COPY4.hold.action);
  assert.equal(h.primaryDomain, null);
  onlyManuscript(h, "hold");
  assert.ok(Object.values(REAL.hold.states).some((st) => st.state === null), "判定なし（null）の領域もある");
  const m = resultCopy3(REAL.mixed);
  assert.equal(REAL.mixed.states[1].state, "5");
  assert.equal(m.kind, "mixed");
  assert.equal(m.title, OVERALL_COPY4.mixed.title);
  assert.deepEqual([...m.paragraphs], [DOMAIN_COPY4[1][5].body]);
  assert.equal(m.action, OVERALL_COPY4.mixed.action);
  onlyManuscript(m, "mixed");
});

// ---------------------------------------------------------------- 三択だけの足し：同じ段の中の並び
test("同じ段の中の並び：選んだ側の強さの大きい順（24問なら番号の順で領域1）", () => {
  const t = tableOf({ 1: "1", 2: { w: [4, 0], L: [90, 20] } });
  assert.equal(t[2].state, "1");
  assert.equal(resultCopyFromStates3(t).primaryDomain, 2);
  assert.equal(resultCopyFromStates(copyStatesOf3(t)).primaryDomain, 1, "24問の決まり（番号の順）なら領域1");
  // B 側は LB で比べる
  const tb = tableOf({ 1: "3", 2: { w: [0, 4], L: [20, 95] } });
  assert.equal(resultCopyFromStates3(tb).primaryDomain, 2);
  // 段は強さより先（状態2 の強い領域より、状態1 の領域が先）
  const tt = tableOf({ 1: { w: [4, 0], L: [100, 60] }, 2: { w: [4, 0], L: [70, 20] } });
  assert.equal(tt[1].state, "2");
  assert.equal(tt[2].state, "1");
  assert.equal(resultCopyFromStates3(tt).primaryDomain, 2);
});

test("同じ段の中の並び：強さが同じなら選んだ側の左右の余裕 → |LA − LB| → 番号", () => {
  const tm = tableOf({ 1: { w: [3, 1], L: [80, 20] }, 2: "1" });
  assert.equal(tm[1].state, "1");
  assert.ok(tm[2].mWA > tm[1].mWA);
  assert.equal(resultCopyFromStates3(tm).primaryDomain, 2, "4:0 の方が 3:1 より余裕が大きい");
  const td = tableOf({ 1: { w: [4, 0], L: [80, 30] }, 2: "1" });
  assert.equal(td[1].state, "1");
  assert.equal(resultCopyFromStates3(td).primaryDomain, 2, "差 60 の方が差 50 より先");
  assert.equal(resultCopyFromStates3(tableOf({ 3: "1", 5: "1" })).primaryDomain, 3, "全部同じなら番号の順");
  // rankOf3 の値
  const k = rankOf3(td[1], "1");
  assert.deepEqual(k, { side: "A", strength: 80, other: 30, margin: td[1].mWA, diff: 50 });
  const kb = rankOf3(tb4(), "4");
  assert.equal(kb.side, "B");
  assert.equal(kb.strength, 80);
  assert.equal(kb.other, 60);
  assert.deepEqual(rankOf3(undefined, "1"), { side: "A", strength: 50, other: 50, margin: -100, diff: 0 }, "値が無ければ強さ 50・余裕 −100");
});
function tb4() { return tableOf({ 1: "4" })[1]; }

// ---------------------------------------------------------------- 補足：選んだ側 ≧ 反対側だけ
test("補足：状態2・4 で反対側の方が強い領域は補足にしない（次の候補へ）", () => {
  // 主軸：領域1 状態1（1A talk_now）。領域4 状態2 で LB 80 ＞ LA 70 → 飛ばす。領域5 状態4（5B need_empathy）が補足
  const base = { 1: "1", 4: { w: [4, 0], L: [70, 80] }, 5: { w: [0, 4], L: [50, 68] } };
  const t = tableOf(base);
  assert.equal(t[4].state, "2");
  assert.equal(t[5].state, "4");
  const c = resultCopyFromStates3(t);
  assert.equal(c.copyId, "B1-1");
  assert.equal(c.bridgeDomain, 5);
  assert.equal(c.bridge, SIDE_COPY4["5B"].bridge);
  // 領域4 の A の方が強ければ（LA 80 ≧ LB 70）、領域4 が先（強さ 80 ＞ 68）
  const t2 = tableOf({ ...base, 4: { w: [4, 0], L: [80, 70] } });
  assert.equal(t2[4].state, "2");
  const c2 = resultCopyFromStates3(t2);
  assert.equal(c2.bridgeDomain, 4);
  assert.equal(c2.bridge, SIDE_COPY4["4A"].bridge);
  // 24問の決まり（強さを見ない）なら領域4
  assert.equal(resultCopyFromStates(copyStatesOf3(t)).bridgeDomain, 4);
});

test("補足：同じテーマ・同じ組は飛ばす（24問と同じ）、字数が 260 を超えたら外す", () => {
  // 主軸 1A talk_now、候補 2A respond_now（同じ組）→ 飛ばす、3A check_contact（同じ組）→ 飛ばす、4A → 補足
  const t = tableOf({ 1: { w: [4, 0], L: [95, 5] }, 2: "1", 3: "1", 4: "1" });
  const c = resultCopyFromStates3(t);
  assert.equal(c.primaryDomain, 1);
  assert.equal(c.bridgeDomain, 4);
  assert.ok(THEME_GROUPS4[0].includes("respond_now") && THEME_GROUPS4[0].includes("check_contact"));
  const short = resultCopyFromStates3(t, { maxChars: 10 });
  assert.equal(short.bridge, null, "字数の上限を超えたら補足を外す（本文は切らない）");
  assert.deepEqual([...short.paragraphs], [...c.paragraphs]);
  assert.equal(COPY_MAX_CHARS4, 260);
});

// ---------------------------------------------------------------- 特別の組：両方 LB ≧ LA のときだけ
test("PAIR-7B-8B：領域7と8が状態3か4・主軸が7か8、かつ両方 LB ≧ LA のときだけ", () => {
  // 領域8 状態3（強さ 90）が主軸、領域7 状態4 で LA 80 ＞ LB 70 → 特別の組にしない（24問の決まりなら特別の組）
  const no = tableOf({ 8: { w: [0, 4], L: [20, 90] }, 7: { w: [0, 4], L: [80, 70] } });
  assert.equal(no[7].state, "4");
  assert.equal(no[8].state, "3");
  const c = resultCopyFromStates3(no);
  assert.equal(c.kind, "primary");
  assert.equal(c.copyId, "B8-3");
  assert.equal(c.bridge, null, "領域7 は反対側の方が強いので補足にもしない");
  assert.equal(resultCopyFromStates(copyStatesOf3(no)).kind, "pair", "24問の決まりなら特別の組");
  const yes = tableOf({ 8: { w: [0, 4], L: [20, 90] }, 7: { w: [0, 4], L: [60, 80] } });
  assert.equal(yes[7].state, "4");
  const p = resultCopyFromStates3(yes);
  assert.equal(p.kind, "pair");
  assert.equal(p.primaryDomain, 8);
  // LB ＝ LA でも可（≧）
  const eq = tableOf({ 8: { w: [0, 4], L: [20, 90] }, 7: { w: [0, 4], L: [70, 70] } });
  assert.equal(eq[7].state, "4");
  assert.equal(resultCopyFromStates3(eq).kind, "pair");
  // 主軸が7・8 でなければ特別の組にしない（24問と同じ）
  const other = tableOf({ 1: { w: [4, 0], L: [100, 0] }, 7: "3", 8: "3" });
  assert.equal(resultCopyFromStates3(other).copyId, "B1-1");
});

// ---------------------------------------------------------------- 72本のうち三択から届く文
test("72本のうち三択から届く本文：主軸の状態（1・2・3・4・1w・3w）×8＝48本と、状態5（mixed の本文）×8＝8本の、合わせて56本", () => {
  const reached = new Set();
  for (const d of DS) {
    for (const s of ["1", "2", "3", "4", "1w", "3w"]) {
      const c = resultCopyFromStates3(tableOf({ [d]: s }));
      // 領域7・8 の状態3・4 は、相手の領域が7なので特別の組にならない
      assert.equal(c.kind, "primary", `B${d}-${s}`);
      assert.equal(c.copyId, `B${d}-${s}`);
      assert.equal(c.title, DOMAIN_COPY4[d][s].title);
      assert.deepEqual([...c.paragraphs], [DOMAIN_COPY4[d][s].body]);
      assert.equal(c.action, SIDE_COPY4[`${d}${["1", "2", "1w"].includes(s) ? "A" : "B"}`].action);
      reached.add(`B${d}-${s}`);
    }
    // 状態5 だけの領域があり、ほかは 6・7 → mixed の本文が B{d}-5
    const m = resultCopyFromStates3(tableOf(Object.fromEntries(DS.map((x) => [x, x === d ? "5" : x < d ? "6" : "7"]))));
    assert.equal(m.kind, "mixed", `B${d}-5`);
    assert.deepEqual([...m.paragraphs], [DOMAIN_COPY4[d][5].body]);
    reached.add(`B${d}-5`);
  }
  assert.equal(reached.size, 56);
  // 状態6・7 の文（16本）は、標準の画面には出ない（主軸にならず、主軸が無いときは全体の文。データとして持つ）
  const all = DS.flatMap((d) => COPY_STATES4.map((s) => `B${d}-${s}`));
  assert.equal(all.length, 72);
  assert.deepEqual(all.filter((id) => !reached.has(id)), DS.flatMap((d) => [`B${d}-6`, `B${d}-7`]));
});

test("出力の文は原稿の写しの文だけ（ランダムな三択の profile 2000件）", () => {
  let seed = 7;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const kinds = new Set();
  for (let i = 0; i < 2000; i++) {
    const levels = {}, w = {};
    for (const d of DS) {
      const n = 2 + Math.floor(rnd() * 5);
      const a = Math.floor(rnd() * (n + 1));
      w[d] = { a, b: n - a };
      levels[T(d, "a")] = Math.round(rnd() * 6) * (100 / 6);
      levels[T(d, "b")] = Math.round(rnd() * 6) * (100 / 6);
    }
    const r = { states: domainStates3({ levels, w }) };
    const c = resultCopy3(r);
    kinds.add(c.kind);
    assert.equal(c.copyVersion, "result-v3.1");
    onlyManuscript(c, `#${i}`);
    if (c.kind === "primary" || c.kind === "pair") {
      assert.ok(["A", "B"].includes(c.side));
      assert.ok(c.action);
    }
    if (c.bridge) {
      const k = rankOf3(r.states[c.bridgeDomain], r.states[c.bridgeDomain].state);
      assert.ok(k.strength >= k.other, `#${i}：補足は選んだ側 ≧ 反対側`);
      assert.ok(["1", "2", "3", "4"].includes(r.states[c.bridgeDomain].state));
    }
    if (c.kind === "pair") for (const d of [7, 8]) assert.ok(r.states[d].LB >= r.states[d].LA, `#${i}：PAIR は LB ≧ LA`);
  }
  for (const k of ["primary", "pair"]) assert.ok(kinds.has(k), `${k} も出る`);   // mixed・hold は上の本当の結果と状態の表で確かめる
  assert.ok(!kinds.has("none"), "三択では none は出ない");
});

test("24問の結果の文は変わらない（resultCopy4 の copyVersion は result-v4.1 のまま。三択の表を渡しても24問の結果にはならない）", () => {
  assert.equal(resultCopy4({ domains: {} }).copyVersion, "result-v4.1");
  assert.equal(resultCopy3({ diagnosisVersion: "v4", domains: {} }).kind, "none");
});

// ---------------------------------------------------------------- ?rc3= ・?tc=
test("?rc3=：既定は原稿の形（copy）。?rc3=old で前の形、知らない値は既定。?rc= とは別", () => {
  assert.equal(DEFAULT_RESULT_COPY3, "copy");
  assert.equal(DEFAULT_TYPE_COPY, "copy");
  assert.equal(DEFAULT_RESULT_COPY, "v4.1", "24問の既定は変えない");
  assert.equal(rc3FromSearch("?rc3=old"), "old");
  assert.equal(rc3FromSearch("?dv=v3&rc3=Copy"), "copy");
  assert.equal(rc3FromSearch("?rc3=u44"), null);
  assert.equal(rc3FromSearch("?rc=old"), null, "?rc= は24問のもの");
  assert.equal(rc3FromSearch(undefined), null);
  assert.equal(resultCopy3Version({ url: null }), "copy");
  assert.equal(resultCopy3Version({ url: "old" }), "old");
  assert.equal(resultCopy3Version({ url: null, def: "old" }), "old");
  assert.equal(resultCopy3Version({ url: "zz", def: "zz" }), "copy");
  assert.equal(isCopyResult3({ url: null }), true);
  assert.equal(isCopyResult3({ url: "old" }), false);
  assert.equal(tcFromSearch("?tc=old&rc3=old"), "old");
  assert.equal(rc3FromSearch("?tc=old&rc3=old"), "old");
});

// ---------------------------------------------------------------- 同じタイトル・同じ絵
test("いちばん上の絵：既定は結果の文の主軸の、選ばれた側の絵（#images・#types の印も同じ）。?rc3=old は前のまま", () => {
  const r = REAL.primary;
  const art = heroArt(r);
  assert.equal(art.id, "1-a");
  assert.equal(art.key, "1A");
  assert.equal(art.tendency, DOMAINS[1].a);
  assert.equal(art.bySide, false);
  assert.equal(art.file, AXIS_ART[1].a.file);
  assert.deepEqual(heroArt3copy(r), art);
  assert.equal(slotMarks(r).hero, "1-a");
  assert.equal(typeMarks(r).hero, "1-a");
  assert.equal(heroArt(REAL.pair).id, "7-b", "特別の組も主軸の絵（B 側）");
  assert.equal(heroArt(REAL.hold), null, "主軸が無ければ絵なし");
  assert.equal(heroArt(REAL.mixed), null);
  assert.equal(slotMarks(REAL.hold).hero, null);
  assert.ok(slotMarks(REAL.hold).picked.length > 0, "8つの軸の行の印（あなたの型）は今までどおり");
  // 前の形は heroTendency から（tests/app_local.test.mjs）。ここでは版で切り替わることだけ
  const old = heroArt(REAL.hold, { rc3: "old" });
  assert.ok(old === null || typeof old.id === "string");
  assert.equal(heroArt(null), null);
  assert.equal(heroArt3copy({}), null);
});

test("ホームのカード（copyCard3）：題は結果の画面と同じ、下は本文の最初の1文（24問の copyCard4 と同じ形）", () => {
  const r = REAL.primary;
  assert.ok(isResult3(r));
  assert.ok(!isResult3({ diagnosisVersion: "v4", states: {} }));
  const c = copyCard3(r);
  assert.equal(c.title, copyOf3(r).title);
  assert.equal(c.sentence, "気まずいまま話が途切れると、どこか落ち着かないこともあるのではないでしょうか。");
  assert.equal(c.kind, "primary");
  const p = copyCard3(REAL.pair);
  assert.equal(p.sentence, "一つのすれ違いに過去の話まで重なると、何から話せばいいか困ることもありますよね。");
  assert.equal(copyCard3(null), null);
  assert.equal(copyOf3({ diagnosisVersion: "v4", domains: {} }), null);
});

test("履歴（diagnosisRecord）：既定は題＝タイトル・下＝本文の最初の1文・copyVersion と copyId。key は前と同じ。前の記録があれば足さない", () => {
  const r = REAL.primary;
  const rec = diagnosisRecord(r);
  assert.equal(rec.kind, "diagnosis");
  assert.equal(rec.title, "話して、ふたりの間をほどいていく。");
  assert.equal(rec.sub, copyCard3(r).sentence);
  assert.equal(rec.data.key, resultKey(r));
  assert.equal(rec.data.copyVersion, "result-v3.1");
  assert.equal(rec.data.copyId, "B1-1");
  assert.equal(rec.data.primaryDomainId, 1);
  assert.deepEqual(rec.data.tendencies, [], "主な傾向の一覧は入れない");
  assert.equal(rec.data.version, "v3");
  assert.equal(rec.data.answered, r.records.length);
  const old = diagnosisRecord(r, { rc3: "old" });
  assert.notEqual(old.title, rec.title);
  assert.equal(old.data.key, rec.data.key, "key は前の形と同じ");
  assert.equal(old.data.copyVersion, undefined);
  // 前の形で記録した物があれば、同じ答えでは足さない（題は前のまま読める）
  useStorage(memory());
  const id = addRecord(old);
  assert.equal(recordDiagnosis(r), id);
  assert.equal(loadRecords().items.length, 1);
  assert.equal(loadRecords().items[0].title, old.title);
  // 新しく記録するときは原稿のタイトル
  useStorage(memory());
  recordDiagnosis(r);
  assert.equal(loadRecords().items[0].title, rec.title);
  assert.equal(loadRecords().items[0].data.copyId, "B1-1");
  useStorage(null);
});

test("シェア（shareTextCopy3）：「恋コンパスで診断しました。」＋改行＋タイトル（24問と同じ形）", () => {
  assert.equal(shareTextCopy3(copyOf3(REAL.primary)), `${SHARE_LEAD}\n話して、ふたりの間をほどいていく。`);
  assert.equal(shareTextCopy3(copyOf3(REAL.pair)), `${SHARE_LEAD}\n${PAIR_7B_8B.title}`);
  assert.equal(shareTextCopy3(copyOf3(REAL.hold)), `${SHARE_LEAD}\n${OVERALL_COPY4.hold.title}`);
  assert.equal(shareTextCopy3(null), SHARE_LEAD);
  const c = copyOf3(REAL.mixed);
  assert.equal(shareTextCopy3(c), shareTextCopy4(c));
});

// ---------------------------------------------------------------- 安全の1行・内訳
test("三択の安全の1行：領域3か6が状態 \"1\" のときだけ。文は24問と同じ", () => {
  assert.deepEqual(safetyDomains3(resOf({ 3: "1" })), [3]);
  assert.deepEqual(safetyDomains3(resOf({ 6: "1" })), [6]);
  assert.deepEqual(safetyDomains3(resOf({ 3: "1", 6: "1" })), [3, 6]);
  for (const s of ["2", "1w", "3", "4", "3w", "5", "6", "7", "null"]) {
    assert.deepEqual(safetyDomains3(resOf({ 3: s === "null" ? null : s, 6: s === "null" ? null : s })), [], `状態 ${s} では出さない`);
  }
  assert.deepEqual(safetyDomains3(null), []);
  assert.deepEqual(safetyDomains3({}), []);
  const n = safetyNote3(resOf({ 3: "1", 6: "1" }));
  assert.deepEqual(n, { domains: [3, 6], texts: [SAFETY_NOTE4[3], SAFETY_NOTE4[6]], tail: SAFETY_NOTE_TAIL4 });
  assert.equal(safetyNote3(resOf({})), null);
  assert.deepEqual(safetyDomains3(REAL.primary), [3], "本当の結果（領域3が状態1）");
});

test("結果の画面の内訳：選んだ数だけ（％・強さの数を出さない）", () => {
  assert.equal(countLine3(1, { a: 5, b: 2, LA: 80, LB: 20 }), "選んだ数：向き合う 5・距離を取る 2");
  assert.equal(countLine3(2, {}), `選んだ数：${DOMAINS[2].a} 0・${DOMAINS[2].b} 0`);
  for (const d of DS) assert.ok(!/%|％|寄り|\d{2,}/.test(countLine3(d, REAL.primary.states[d]).replace(/選んだ数：/, "")), `領域${d}：％や強さの数を出さない`);
  assert.ok(!/%|％/.test(BREAKDOWN_LEGEND3 + BREAKDOWN_NOTE3));
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
