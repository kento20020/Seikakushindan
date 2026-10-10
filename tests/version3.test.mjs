// node tests/version3.test.mjs
// 三択版の設問の版（v1／v2）のテスト。仕様：docs/three-choice-logic.md の「v2（3choice-2026-10-10）」
//  - 版の決め方（URL ?qv= ＞ 保存中のセッションの版 ＞ 既定）、設問バンクの version → 版
//  - v1 のセッションは従来どおり（全部拮抗で96問）、v2 は上限 W8・X8（全部拮抗で80問）
//  - v2 の W追加の優先順位（拮抗 → 向きが逆 → 優勢（弱））、X追加に向きが逆の領域の両傾向
//  - v2 の判定：確度低の領域を含むパターン ×0.8（形状を除く）、矛盾枠の向きの条件（同じ level は不成立）
//  - 場面例の差し替えは v2 だけ、練習カードは記録に入らない、送信 JSON の qv、toJSON/fromJSON で版が残る
//  - 集計ページ：v1 と v2 の送信を一緒に読み、版で文が違う設問は別の行、再採点のロジックを切り替えられる
import assert from "node:assert/strict";
import {
  THREE_VERSIONS, DEFAULT_THREE_VERSION, LIB_DEFAULT_VERSION, resolveVersion, versionFromBank, versionFromSearch, scenesFor, scenesChanged, SCENES_V2, PRACTICE_CARD,
} from "../js/three_version.js";
import { createSession3, Session3, drive, bankFor, fromLikertAnswers, fromScores, W_ITEMS, ITEM3, isTied } from "../js/adaptive3.js";
import { evaluateAll3, select3, lowConfDomains3, domainFlags3, contraMisaligned3, patternMargin3, META3_BY_ID, CONTRA_ALIGN_REASON, CONFLICT_GAP } from "../js/engine3.js";
import { encodeText } from "../js/feedback_format.js";
import { DOMAINS, TRAITS, PAIR } from "../js/engine.js";
import { QUESTIONS3 } from "../js/data/questions3.js";
import { QUESTIONS3_V2 } from "../js/data/questions3_v2.js";
import { SAMPLES3, PROFILE_SAMPLES3 } from "../js/data/samples3.js";
import { newFeedback, buildPayload, buildText, chipOrder, itemTexts, HARD_CODES } from "../js/feedback_collect.js";
import { parseInput, analyzeParsed, itemTable, payloadQv, itemRowKey, cardSummary } from "../js/admin/aggregate.js";
import { PATTERN_BY_ID } from "../js/data/patterns.js";
import { rescoreAll, rescoreSession } from "../js/admin/rescore.js";
import { store3, start3, practice3, practicePending3, answer3, discard3, runSample3 } from "../js/ui/three_store.js";

let fail = 0, pass = 0;
function test(name, fn) {
  try { fn(); pass++; console.log("OK   " + name); }
  catch (e) { fail++; console.log("FAIL " + name + "\n  " + (e.stack || e).toString().split("\n").slice(0, 6).join("\n  ")); }
}
const sideOf = (c, t) => c.question.left.trait === t ? "left" : "right";
const counts = (arr) => arr.reduce((o, x) => (o[x] = (o[x] || 0) + 1, o), {});

/** 版 v のラウンド1〜4で、各傾向がちょうど2勝2敗になる勝者（全 level 50） */
function evenWinners(v) {
  const B = bankFor(v);
  const adj = {}, winner = {};
  for (let r = 1; r <= 4; r++) B.bank.xRounds[r - 1].forEach((_, i) => {
    const q = B.X_ITEMS[`X${r}-${i + 1}`];
    (adj[q.left] ||= []).push({ id: q.id, to: q.right }); (adj[q.right] ||= []).push({ id: q.id, to: q.left });
  });
  for (const start of Object.keys(adj)) {
    const stack = [start];
    while (stack.length) {
      const x = stack[stack.length - 1];
      const e = adj[x].find(y => !winner[y.id]);
      if (e) { winner[e.id] = x; stack.push(e.to); } else stack.pop();
    }
  }
  return winner;
}
/** 全領域拮抗（W は a,b,a,b…）・X は2勝2敗で流す。聞いた段階の列 */
function runAllTie(s) {
  const win = evenWinners(s.version);
  const seq = [];
  drive(s, c => {
    seq.push(c.stage);
    if (c.kind === "W") { const D = DOMAINS[c.domain]; return sideOf(c, c.n % 2 === 1 ? D.a : D.b); }
    return win[c.question.id] ? sideOf(c, win[c.question.id]) : "left";
  });
  return seq;
}
const P = (w, levels) => {
  const lv = Object.fromEntries(TRAITS.map(t => [t, 50]));
  Object.assign(lv, levels);
  const ww = {}; for (const d of Object.keys(DOMAINS)) { const [a, b] = w[d] || [0, 0]; ww[d] = { a, b, n: a + b }; }
  return { levels: lv, w: ww, quality: { ok: true } };
};
const V2 = THREE_VERSIONS.v2.logic;

// ---------------------------------------------------------------- 1. 版の一覧と決め方
test("版の一覧：v1＝questions3.js（3choice-2026-10-08）、v2＝questions3_v2.js（3choice-2026-10-10）。既定は v2、ライブラリの既定は v1", () => {
  assert.equal(THREE_VERSIONS.v1.bank, QUESTIONS3); assert.equal(THREE_VERSIONS.v2.bank, QUESTIONS3_V2);
  assert.equal(THREE_VERSIONS.v1.bankVersion, "3choice-2026-10-08"); assert.equal(THREE_VERSIONS.v2.bankVersion, "3choice-2026-10-10");
  assert.equal(DEFAULT_THREE_VERSION, "v2", "仕様の既定は v2（v1 に戻したらここだけ直す）"); assert.equal(LIB_DEFAULT_VERSION, "v1");
  assert.deepEqual(THREE_VERSIONS.v1.caps, { wExtra: 16, xExtra: 16, wPerDomain: 2, xPerTrait: 2 });
  assert.deepEqual(THREE_VERSIONS.v2.caps, { wExtra: 8, xExtra: 8, wPerDomain: 2, xPerTrait: 2 });
  assert.equal(THREE_VERSIONS.v1.practice, false); assert.equal(THREE_VERSIONS.v2.practice, true);
  assert.deepEqual(THREE_VERSIONS.v2.logic.wExtra, ["tie", "conflict", "weak"]);
});
test("resolveVersion：URL の ?qv= ＞ 保存中のセッションの版 ＞ 既定。知らない値は無視", () => {
  assert.equal(resolveVersion({}), DEFAULT_THREE_VERSION);
  assert.equal(resolveVersion({ saved: "v1" }), "v1");
  assert.equal(resolveVersion({ search: "?qv=v2", saved: "v1" }), "v2");
  assert.equal(resolveVersion({ search: "?fb=1&qv=v1", saved: "v2" }), "v1");
  assert.equal(resolveVersion({ search: "?qv=V1" }), "v1", "大文字も読む");
  assert.equal(resolveVersion({ search: "?qv=v9", saved: "v1" }), "v1", "知らない qv は保存中の版へ");
  assert.equal(resolveVersion({ search: "?qv=v9", saved: "x" }), DEFAULT_THREE_VERSION, "どちらも知らなければ既定");
  assert.equal(resolveVersion({ search: "", saved: null, fallback: "v1" }), "v1", "既定（DEFAULT_THREE_VERSION）を v1 にした場合");
  assert.equal(versionFromSearch("?qv="), null);
});
test("versionFromBank：設問バンクの version → 版（知らなければ null）", () => {
  assert.equal(versionFromBank("3choice-2026-10-08"), "v1");
  assert.equal(versionFromBank("3choice-2026-10-10"), "v2");
  assert.equal(versionFromBank("old"), null); assert.equal(versionFromBank(undefined), null);
});

// ---------------------------------------------------------------- 2. 設問の索引
test("bankFor：版ごとの索引。名前つきの export（W_ITEMS・ITEM3）は v1 のまま。v2 は W 10問の文と X の4か所の組が違う", () => {
  const b1 = bankFor("v1"), b2 = bankFor("v2");
  assert.equal(b1.ITEM3, ITEM3); assert.equal(b1.W_ITEMS, W_ITEMS);
  assert.equal(bankFor("v2"), b2, "一度だけ作る");
  assert.equal(Object.keys(b2.W_ITEMS).length, 72); assert.equal(Object.keys(b2.X_ITEMS).length, 56);
  const changedW = Object.keys(b1.W_ITEMS).filter(id => { const a = b1.W_ITEMS[id], b = b2.W_ITEMS[id]; return a.stem !== b.stem || a.a !== b.a || a.b !== b.b; });
  assert.deepEqual(changedW.sort(), QUESTIONS3_V2.changesFromV1.w.map(c => c.id).sort());
  for (const c of QUESTIONS3_V2.changesFromV1.w) {
    assert.deepEqual([b1.W_ITEMS[c.id].stem, b1.W_ITEMS[c.id].a, b1.W_ITEMS[c.id].b], [c.before.stem, c.before.a, c.before.b], c.id);
    assert.deepEqual([b2.W_ITEMS[c.id].stem, b2.W_ITEMS[c.id].a, b2.W_ITEMS[c.id].b], [c.after.stem, c.after.a, c.after.b], c.id);
  }
  const changedX = Object.keys(b1.X_ITEMS).filter(id => b1.X_ITEMS[id].left !== b2.X_ITEMS[id].left || b1.X_ITEMS[id].right !== b2.X_ITEMS[id].right);
  assert.deepEqual(changedX.sort(), QUESTIONS3_V2.changesFromV1.x.flatMap(c => c.ids).sort());
  // v2 の X も各ラウンドで16傾向を1回ずつ、同じ領域どうしは組まない
  for (let r = 1; r <= 7; r++) {
    const qs = Object.values(b2.X_ITEMS).filter(q => q.round === r);
    assert.equal(new Set(qs.flatMap(q => [q.left, q.right])).size, 16, `R${r}`);
    for (const q of qs) assert.notEqual(DOMAINS[Object.keys(DOMAINS).find(d => DOMAINS[d].a === q.left || DOMAINS[d].b === q.left)], DOMAINS[Object.keys(DOMAINS).find(d => DOMAINS[d].a === q.right || DOMAINS[d].b === q.right)], q.id);
  }
});

// ---------------------------------------------------------------- 3. v1 は従来どおり
test("版を渡さないセッションは v1：config.version v1、全部拮抗で96問（W追加16・X追加16）", () => {
  const s = createSession3();
  assert.equal(s.version, "v1"); assert.equal(s.config.version, "v1");
  assert.equal(s.current().question.left.text, QUESTIONS3.pairs[1][0].a, "W1-1 は v1 の文");
  const seq = runAllTie(s);
  assert.deepEqual(counts(seq), { "W基本": 32, "X基本": 32, "W追加": 16, "X追加": 16 });
  const r = s.result();
  assert.equal(r.version, "v1"); assert.equal(r.bankVersion, "3choice-2026-10-08");
  assert.deepEqual(r.lowConf, {}, "v1 には確度低の扱いがない");
  assert.ok(r.select.hits.every(h => !h.factor));
});
test("v1 のセッションの選択は select3（版の指定なし）と同じ：サンプル7件", () => {
  for (const smp of SAMPLES3) {
    const r = fromLikertAnswers(smp.answers, smp.wording).result();
    assert.deepEqual(r.select.chosen.map(h => h.meta.id), select3(r.profile3).chosen.map(h => h.meta.id), smp.key);
    assert.equal(r.version, "v1");
  }
  for (const p of PROFILE_SAMPLES3) {
    const r = fromScores(p.scores, p.duel).result();
    assert.deepEqual(r.select.chosen.map(h => h.meta.id), select3(r.profile3).chosen.map(h => h.meta.id), p.key);
  }
});

// ---------------------------------------------------------------- 4. v2 の上限と計画
test("v2：全部拮抗で 64＋8＋8＝80問（上限 W8・X8、領域・傾向あたり2）", () => {
  const s = createSession3({ version: "v2" });
  assert.equal(s.current().question.left.text, QUESTIONS3_V2.pairs[1][0].a, "W1-1 は v2 の文");
  assert.equal(s.progress().max, 80);
  const seq = runAllTie(s);
  assert.ok(seq.length <= 64 + 16);
  assert.deepEqual(counts(seq), { "W基本": 32, "X基本": 32, "W追加": 8, "X追加": 8 });
  const r = s.result();
  assert.ok(Object.values(counts(r.stages.wExtra.map(x => x.domain))).every(n => n <= 2));
  assert.ok(r.stages.wExtra.every(x => x.why === "tie"));
  // 1巡目は領域1〜8に1問ずつ（拮抗だけなので領域番号順）
  assert.deepEqual(r.stages.wExtra.map(x => x.domain), [1, 2, 3, 4, 5, 6, 7, 8]);
});

/**
 * 領域1：拮抗（W 2:2）、領域2：向きが逆（W 4:0 で即応が優勢、X は熟考が圧勝）、領域3：優勢（弱）（W 3:1 で追う、X は追う 25・待つ 0）、
 * 領域4：優勢（弱）（W 4:0 で表に出す、X は 50）、領域5〜8：A側が W 4:0・X でも強い（追加なし）。X は score の高い方を選ぶ
 */
const SCORE = { "向き合う": 50, "距離を取る": 50, "即応": 5, "熟考": 97, "追う": 8, "待つ": 6,
  "表に出す": 90, "内に置く": 10, "理由・具体": 91, "気持ち・共感": 11, "主導する": 92, "調整する": 12, "広げる": 93, "切り分ける": 13, "解決する": 94, "関係を戻す": 14 };
function planCase(version) {
  const s = createSession3({ version });
  const respondW = (c) => {
    const D = DOMAINS[c.domain];
    if (c.domain === 1) return sideOf(c, c.n % 2 === 1 ? D.a : D.b);
    if (c.domain === 3) return sideOf(c, c.n <= 3 ? D.a : D.b);
    return sideOf(c, D.a);
  };
  const respondX = (c) => { const { left: l, right: r } = c.question; return SCORE[l.trait] >= SCORE[r.trait] ? "left" : "right"; };
  while (s.current().stageNo <= 2) { const c = s.current(); s.answer(c.kind === "W" ? respondW(c) : respondX(c)); }
  return { s, respondW, respondX };
}
const KIND_ORDER = ["tie", "conflict", "weak"];
/** 期待する W追加の並び：種類（拮抗＞向きが逆＞弱い）・領域番号で並べ、1巡目に1問ずつ、2巡目で2問目、全体 cap まで */
function expectedPlan(prof, cap = 8) {
  const kinds = Object.keys(DOMAINS).map(Number).map(d => {
    const f = domainFlags3(prof, d);
    return { d, kind: isTied(prof.w[d]) ? "tie" : f.conflict ? "conflict" : f.weak ? "weak" : null };
  }).filter(x => x.kind).sort((x, y) => KIND_ORDER.indexOf(x.kind) - KIND_ORDER.indexOf(y.kind) || x.d - y.d);
  return [...kinds, ...kinds].slice(0, cap).map(x => [x.d, x.kind]);
}
test("v2 の W追加：拮抗 → 向きが逆 → 優勢（弱）の順（同じ種類は領域番号順）、1巡目に1問ずつ、2巡目で2問目", () => {
  const { s } = planCase("v2");
  const prof = s.result().profile3;
  assert.ok(isTied(prof.w[1]), "領域1は拮抗");
  const f2 = domainFlags3(prof, 2), f3 = domainFlags3(prof, 3), f4 = domainFlags3(prof, 4);
  assert.equal(f2.lead, "即応"); assert.ok(f2.conflict, `領域2は向きが逆（${f2.L} vs ${f2.Lo}）`);
  assert.equal(f3.lead, "追う"); assert.ok(f3.weak && !f3.conflict, `領域3は優勢（弱）（${f3.L} vs ${f3.Lo}）`);
  assert.equal(f4.lead, "表に出す"); assert.ok(f4.weak && !f4.conflict, `領域4は優勢（弱）（${f4.L} vs ${f4.Lo}）`);
  for (const d of [5, 6, 7, 8]) { const f = domainFlags3(prof, d); assert.ok(f.lead && !f.weak && !f.conflict, `領域${d} は追加なし（${f.L}/${f.Lo}）`); }
  assert.equal(s.current().stage, "W追加");
  const plan = s.plan.s3.map(st => [st.domain, st.why]);
  assert.deepEqual(plan, [[1, "tie"], [2, "conflict"], [3, "weak"], [4, "weak"], [1, "tie"], [2, "conflict"], [3, "weak"], [4, "weak"]]);
  assert.deepEqual(plan, expectedPlan(prof));
  assert.match(s.plan.s3[1].reason, /向きが逆/); assert.match(s.plan.s3[2].reason, /優勢（弱）/);
  assert.equal(s.current().domain, 1);
});
test("v1 の W追加は同じ回答でも拮抗した領域1だけ", () => {
  const { s } = planCase("v1");
  assert.deepEqual(s.plan.s3.map(st => st.domain), [1, 1]);
  assert.ok(s.plan.s3.every(st => st.why === undefined), "v1 の計画の形は従来どおり");
});
test("v2：1問ごとに計画し直す。弱い領域（3:1）で反対側を答えて 3:2（拮抗）になると、2巡目の優先が上がる", () => {
  const { s, respondW } = planCase("v2");
  s.answer(respondW(s.current()));                         // 領域1（拮抗）1問目
  assert.equal(s.current().domain, 2);
  s.answer(sideOf(s.current(), "即応"));                   // 領域2：即応 5:0（向きが逆のまま）
  assert.equal(s.current().domain, 3);
  s.answer(sideOf(s.current(), "待つ"));                   // 領域3：3:2 → 拮抗
  assert.ok(isTied(s.result().w[3]));
  const order = s.plan.s3.filter(st => !s.state[st.key]).map(st => [st.domain, st.why]);
  assert.deepEqual(order, [[4, "weak"], [1, "tie"], [3, "tie"], [2, "conflict"], [4, "weak"]]);
  assert.equal(s.plan.s3.length, 8);
});
test("v2 の X追加：向きが逆の領域の両傾向（即応・熟考）を最優先で足す。上限8", () => {
  const { s, respondW, respondX } = planCase("v2");
  drive(s, c => c.kind === "W" ? respondW(c) : respondX(c));
  const r = s.result();
  assert.ok(r.stages.xExtra.length <= 8);
  const first = r.stages.xExtra.slice(0, 2).map(x => x.target);
  assert.deepEqual(first.sort(), ["即応", "熟考"].sort(), JSON.stringify(r.stages.xExtra.map(x => x.target)));
  assert.ok(r.stages.xExtra.filter(x => x.why === "conflict").every(x => /向きが逆/.test(x.reason)));
  // v1 では向きが逆の傾向は X追加に入らない（level が 40〜60 でも回答数<3 でもない）
  const { s: s1, respondW: w1, respondX: x1 } = planCase("v1");
  drive(s1, c => c.kind === "W" ? w1(c) : x1(c));
  assert.ok(!s1.result().stages.xExtra.some(x => x.target === "即応" || x.target === "熟考"));
});

// ---------------------------------------------------------------- 5. v2 の判定
test("確度低：weak（優勢側の level<67）と conflict（反対側が25以上高い）。拮抗の領域は入らない", () => {
  const p = P({ 1: [3, 1], 2: [4, 0], 3: [2, 2], 4: [0, 4] }, { "向き合う": 50, "距離を取る": 25, "即応": 25, "熟考": 75, "表に出す": 50, "内に置く": 75 });
  const lc = lowConfDomains3(p);
  assert.deepEqual(Object.keys(lc), ["1", "2"]);
  assert.deepEqual(lc[1].reasons, ["weak"]);
  assert.deepEqual(lc[2].reasons, ["conflict", "weak"]);
  assert.match(lc[2].text, /熟考 75 が即応 25 より50高い/);
  assert.equal(CONFLICT_GAP, 25);
  assert.ok(!lc[3] && !lc[4], "拮抗（2:2）と、強い優勢（内に置く 75）は入らない");
});
test("確度低 ×0.8：確度低の領域を含むパターンだけ。details に理由、hit.factor・baseScore。形状（S19）は対象外", () => {
  const w = {}; for (const d of Object.keys(DOMAINS)) w[d] = [3, 1];
  const p = P(w, {});                                        // 全領域 3:1・level 50 → 全領域が優勢（弱）
  const v1 = Object.fromEntries(evaluateAll3(p).map(h => [h.meta.id, h]));
  const v2 = Object.fromEntries(evaluateAll3(p, { logic: V2 }).map(h => [h.meta.id, h]));
  assert.ok(v1.S19 && v2.S19, "S19（全領域で A側が優勢）が発火");
  assert.equal(v2.S19.score, v1.S19.score); assert.equal(v2.S19.factor, undefined, "形状は ×0.8 しない");
  assert.ok(v1["B1-1w"] && v2["B1-1w"]);
  assert.ok(Math.abs(v2["B1-1w"].score - v1["B1-1w"].score * 0.8) < 1e-12);
  assert.equal(v2["B1-1w"].factor, 0.8); assert.equal(v2["B1-1w"].baseScore, v1["B1-1w"].score);
  const d = v2["B1-1w"].details.find(x => x.kind === "lowConf");
  assert.ok(d && d.factor === 0.8 && d.margin === null && /確度低/.test(d.label) && /優勢（弱）/.test(d.label), JSON.stringify(d));
  assert.equal(v2["B1-1w"].margin, v1["B1-1w"].margin, "余裕と充足度は変えない");
  // 確度低の無い領域だけのパターンは変わらない
  const p2 = P({ 1: [4, 0], 2: [4, 0] }, { "向き合う": 75, "距離を取る": 25, "即応": 75, "熟考": 25 });
  const a = evaluateAll3(p2).find(h => h.meta.id === "X12-1"), b = evaluateAll3(p2, { logic: V2 }).find(h => h.meta.id === "X12-1");
  assert.ok(a && b); assert.equal(b.score, a.score); assert.ok(!b.factor);
});
test("確度低の領域を含むパターンは主軸に選ばれにくくなる（select3 に logic を渡す）", () => {
  // 領域1は優勢（弱）、領域2は強い。v1 で主軸の B1-1w 系より、v2 では確度低でない方が上に来る
  const p = P({ 1: [4, 0], 2: [4, 0] }, { "向き合う": 50, "距離を取る": 25, "即応": 100, "熟考": 0 });
  const s1 = select3(p), s2 = select3(p, { logic: V2 });
  const top = (sel) => sel.hits.find(h => !h.meta.group || h.meta.group !== "D");
  assert.ok(s2.hits.filter(h => h.meta.domains.includes(1) && h.meta.group !== "D").every(h => h.factor === 0.8));
  assert.ok(top(s2).score <= top(s1).score);
});
test("矛盾枠の向き（v2）：W 3:1 で level 75/75（同じ）なら矛盾枠のクロスは外れる。level(t) ＞ 反対側なら残る", () => {
  const meta = META3_BY_ID["X16-2"];                         // 優勢:向き合う × 優勢:調整する（矛盾枠）
  assert.ok(meta.contra && meta.kind === "cross");
  const eqp = P({ 1: [3, 1], 6: [1, 3] }, { "向き合う": 75, "距離を取る": 75, "調整する": 75, "主導する": 25 });
  assert.ok(evaluateAll3(eqp).some(h => h.meta.id === "X16-2"), "v1 では発火");
  assert.ok(!evaluateAll3(eqp, { logic: V2 }).some(h => h.meta.id === "X16-2"), "v2 では外れる");
  assert.deepEqual(contraMisaligned3(meta, eqp).map(x => x.t), ["向き合う"]);
  const okp = P({ 1: [3, 1], 6: [1, 3] }, { "向き合う": 75, "距離を取る": 50, "調整する": 75, "主導する": 25 });
  const hit = evaluateAll3(okp, { logic: { contraAlign: true } }).find(h => h.meta.id === "X16-2");
  assert.ok(hit, "向き合う 75 ＞ 距離を取る 50、調整する 75 ＞ 主導する 25 なら残る");
  assert.ok(!hit.details.some(x => x.kind === "contra"));
});
test("矛盾枠の向き：理由が details に残る（余裕 −1）。基本の状態5・優勢を含まない特殊B・C は対象外", () => {
  const eqp = P({ 1: [3, 1], 6: [1, 3] }, { "向き合う": 75, "距離を取る": 75, "調整する": 75, "主導する": 25 });
  const details = [];
  const m = patternMargin3(META3_BY_ID["X16-2"], eqp, details, V2);
  assert.equal(m, -1);
  assert.ok(details.some(d => d.kind === "contra" && d.margin === -1 && d.label.startsWith(CONTRA_ALIGN_REASON)), JSON.stringify(details));
  // 基本の状態5（両方強い）
  const p5 = P({ 1: [2, 2] }, { "向き合う": 75, "距離を取る": 75 });
  assert.ok(META3_BY_ID["B1-5"].contra);
  assert.ok(evaluateAll3(p5, { logic: { contraAlign: true } }).some(h => h.meta.id === "B1-5"), "B1-5 は対象外");
  assert.deepEqual(contraMisaligned3(META3_BY_ID.S07, p5), []); assert.deepEqual(contraMisaligned3(META3_BY_ID.S13, p5), []);
});
test("Session3 v2 の result()：version・bankVersion・lowConf（理由つき）、選択は v2 のロジック", () => {
  const s = fromLikertAnswers(SAMPLES3[0].answers, SAMPLES3[0].wording, { version: "v2" });
  const r = s.result();
  assert.equal(r.version, "v2"); assert.equal(r.bankVersion, "3choice-2026-10-10"); assert.equal(r.logic.id, "v2");
  assert.deepEqual(r.lowConf, lowConfDomains3(r.profile3));
  for (const lc of Object.values(r.lowConf)) assert.ok(lc.reasons.length && lc.reasons.every(x => x === "weak" || x === "conflict"));
  assert.deepEqual(r.select.chosen.map(h => h.meta.id), select3(r.profile3, { logic: V2 }).chosen.map(h => h.meta.id));
  assert.ok(s.records().length <= 80);
  assert.equal(fromScores(PROFILE_SAMPLES3[0].scores, PROFILE_SAMPLES3[0].duel, { version: "v2" }).version, "v2");
});

// ---------------------------------------------------------------- 6. 場面例・練習カード
test("場面例の差し替えは v2 だけ（弱い版 B?-1w／3w は元の id でも探す）", () => {
  const ids = Object.keys(SCENES_V2);
  const injected = !ids.length;
  if (injected) SCENES_V2["B1-1"] = ["v2 の場面1", "v2 の場面2"];
  try {
    const id = Object.keys(SCENES_V2)[0];
    const orig = ["元の場面1", "元の場面2"];
    assert.deepEqual(scenesFor(id, "v1", orig), orig);
    assert.deepEqual(scenesFor(id, "v2", orig), SCENES_V2[id]);
    assert.equal(scenesChanged(id, "v2"), true); assert.equal(scenesChanged(id, "v1"), false);
    assert.deepEqual(scenesFor("ZZ-unknown", "v2", orig), orig);
    if (/^B\d-[13]$/.test(id)) assert.deepEqual(scenesFor(`${id}w`, "v2", orig), SCENES_V2[id]);
    for (const [k, v] of Object.entries(SCENES_V2)) assert.ok(Array.isArray(v) && v.length >= 2 && v.every(x => typeof x === "string" && x), `${k} の場面は2つ以上の文`);
  } finally { if (injected) delete SCENES_V2["B1-1"]; }
});
test("練習カード（v2）：開始すると1問目の前に出て、答えても記録・回答数・操作履歴に入らない。v1 には無い", () => {
  discard3();
  start3({ adaptive: true, version: "v2" });
  assert.equal(store3.session.version, "v2");
  assert.equal(practicePending3(), true);
  assert.equal(PRACTICE_CARD.stem, "練習：休日の朝、より近いのは？");
  assert.deepEqual([PRACTICE_CARD.left, PRACTICE_CARD.right], ["早起きして出かける", "ゆっくり寝ている"]);
  assert.equal(practice3("left"), true);
  assert.equal(practicePending3(), false);
  assert.equal(store3.session.records().length, 0); assert.equal(store3.session.log.length, 0); assert.equal(store3.session.progress().answered, 0);
  assert.equal(store3.session.current().key, "WB-1-1", "練習のあとは W基本の1問目");
  assert.equal(practice3("left"), false, "二度目は無い");
  answer3("left");
  assert.equal(store3.session.records().length, 1);
  discard3();
  start3({ adaptive: true, version: "v1" });
  assert.equal(practicePending3(), false); assert.equal(store3.practice, null);
  discard3();
});
test("サンプルは開始画面で選んでいる版（store3.qv）で流す", () => {
  store3.qv = "v1"; runSample3(0);
  assert.equal(store3.session.version, "v1"); assert.equal(store3.result.version, "v1");
  store3.qv = "v2"; runSample3(0);
  assert.equal(store3.session.version, "v2"); assert.equal(store3.result.version, "v2");
  discard3();
});

// ---------------------------------------------------------------- 7. 保存・送信
test("toJSON / fromJSON：版が残り、v2 の設問・計画のまま再開できる。版の無い古い保存は v1", () => {
  const s = createSession3({ version: "v2" });
  for (let i = 0; i < 40; i++) s.answer(i % 3 ? "left" : "right");
  const j = JSON.parse(JSON.stringify(s.toJSON()));
  assert.equal(j.config.version, "v2");
  const t = Session3.fromJSON(j);
  assert.equal(t.version, "v2"); assert.equal(t.bank, bankFor("v2"));
  assert.deepEqual(t.current(), s.current());
  assert.deepEqual(t.records(), s.records());
  const old = JSON.parse(JSON.stringify(createSession3().toJSON()));
  delete old.config.version;
  assert.equal(Session3.fromJSON(old).version, "v1");
});
test("送信 JSON：app はセッションの設問バンクの version、末尾に qv。v1 は qv \"v1\"", () => {
  for (const v of ["v1", "v2"]) {
    const s = createSession3({ version: v });
    drive(s, c => c.kind === "W" ? "left" : "right");
    const fb = newFeedback({ code: "q" + v, now: new Date(2026, 9, 10, 10, 0, 0) });
    const p = buildPayload({ session: s, result: s.result(), fb });
    assert.equal(p.app, THREE_VERSIONS[v].bankVersion); assert.equal(p.qv, v);
    const keys = Object.keys(p);
    assert.equal(keys[keys.length - 1], "qv");
    assert.deepEqual(keys.slice(0, -1), ["v", "app", "code", "ts", "mode", "dur", "back", "ua", "rec", "res", "fb"]);
  }
});
test("振り返りの設問の文はセッションの版の設問バンクから", () => {
  assert.equal(itemTexts("W3-3", "v1").a, bankFor("v1").W_ITEMS["W3-3"].a);
  assert.equal(itemTexts("W3-3", "v2").a, bankFor("v2").W_ITEMS["W3-3"].a);
  assert.notEqual(itemTexts("W3-3", "v1").a, itemTexts("W3-3", "v2").a);
  assert.equal(itemTexts("W3-3").a, itemTexts("W3-3", "v1").a);
});
test("振り返りの理由チップの並び：設問ごとに並べ替え、同じコード＋設問なら毎回同じ。中身は5つのまま", () => {
  const a = chipOrder("ab12", "W3-3"), b = chipOrder("ab12", "W3-3");
  assert.deepEqual(a, b);
  assert.deepEqual([...a].sort(), [...HARD_CODES].sort());
  const orders = new Set(["W1-1", "W1-2", "W2-1", "X1-1", "X2-5", "W6-4", "Q73a", "D3x"].map(id => chipOrder("ab12", id).join(",")));
  assert.ok(orders.size >= 3, `並びが設問で変わる（${orders.size}通り）`);
  assert.notDeepEqual(chipOrder("zz", "W3-3"), undefined);
});

// ---------------------------------------------------------------- 8. 集計ページ
function textFor(version, code, respond) {
  const s = createSession3({ version });
  drive(s, respond);
  const fb = newFeedback({ code, now: new Date(2026, 9, 10, 9, version === "v1" ? 0 : 30, 0) });
  fb.time = "ok"; fb.swipe = 3;
  return { s, ...buildText({ session: s, result: s.result(), fb }) };
}
test("集計：v1 と v2 の送信を一緒に読む。qv の無い送信は v1。版で文が違う設問は別の行（id_v2）", () => {
  const respond = (c) => c.kind === "W" ? (c.n % 3 ? "left" : "right") : (c.question.id.endsWith("1") ? "right" : "left");
  const a = textFor("v1", "one", respond), b = textFor("v2", "two", respond);
  // v1 のころの送信には qv が無い：取り除いて読ませる
  const p1 = { ...a.payload }; delete p1.qv;
  assert.equal(payloadQv(p1), "v1"); assert.equal(payloadQv(b.payload), "v2"); assert.equal(payloadQv({ app: "3choice-2026-10-10" }), "v2");
  const text = [encodeText(p1, ["v1"]), b.text].join("\n\n");
  const parsed = parseInput(text);
  assert.equal(parsed.errors.length, 0);
  assert.deepEqual(parsed.sessions.map(s => s.qv), ["v1", "v2"]);
  assert.deepEqual(parsed.versions, { v1: 1, v2: 1 });
  assert.ok(!parsed.warnings.some(w => /設問版/.test(w)), parsed.warnings.join(" / "));
  const model = analyzeParsed(parsed);
  const rows = model.items.items;
  const w11 = rows.find(x => x.key === "W1-1"), w11v2 = rows.find(x => x.key === "W1-1_v2");
  assert.ok(w11 && w11v2, rows.map(x => x.key).slice(0, 12).join(","));
  assert.equal(w11.stem, bankFor("v1").W_ITEMS["W1-1"].stem); assert.equal(w11v2.stem, bankFor("v2").W_ITEMS["W1-1"].stem);
  assert.equal(w11.variant, "v1"); assert.equal(w11v2.variant, "v2");
  assert.equal(w11.shown + w11v2.shown, 2);
  const w21 = rows.find(x => x.key === "W2-1");
  assert.ok(w21 && !rows.some(x => x.key === "W2-1_v2") && w21.shown === 2, "同じ文の設問は版をまたいで1行");
  assert.equal(itemRowKey("X1-1", "v2"), "X1-1_v2"); assert.equal(itemRowKey("X1-2", "v2"), "X1-2");
  // v1 だけなら従来どおり（未出題も含めると v1 の 72＋56）
  const only1 = parseInput(encodeText(p1, ["v1"]));
  assert.equal(itemTable(only1.sessions, { includeUnseen: true }).items.length, 72 + 56);
  // 再採点：当時の版のロジックなら両方「同じ」
  const rsThen = rescoreAll(parsed.sessions);
  assert.equal(rsThen.mode, "then");
  assert.deepEqual(rsThen.rows.map(r => [r.qv, r.logic, r.status]), [["v1", "v1", "same"], ["v2", "v2", "same"]]);
  assert.deepEqual(rsThen.rows[1].now, b.payload.res);
  // v2 のロジック：v1 の送信は確度低の差（と、あれば採用の差）が出る。v2 の送信は同じ
  const rsV2 = rescoreAll(parsed.sessions, { mode: "v2" });
  assert.equal(rsV2.rows[1].status, "same");
  const r1 = rsV2.rows[0];
  assert.equal(r1.logic, "v2");
  const expectLow = lowConfDomains3(a.s.result().profile3);
  assert.deepEqual(Object.keys(r1.lowConf.now), Object.keys(expectLow));
  assert.deepEqual(r1.lowConf.then, {});
  assert.equal(r1.status, Object.keys(expectLow).length || !r1.diff.chosen.same ? "diff" : "same");
  assert.deepEqual(r1.now.chosen.map(c => c[0]).sort(), select3(a.s.result().profile3, { logic: V2 }).chosen.map(h => h.meta.id).sort());
  assert.equal(rescoreSession(parsed.sessions[0], { mode: "v2" }).status, r1.status);
});

test("集計：カード評価の場面例は、v2 で差し替えたパターンなら v2 の文として別に数える（v1 だけなら従来どおり）", () => {
  const id = Object.keys(SCENES_V2).find(k => PATTERN_BY_ID[k]) || "B1-1";
  const injected = !SCENES_V2[id];
  if (injected) SCENES_V2[id] = ["v2 の場面1", "v2 の場面2"];
  try {
    const mk = (qv, code, sc) => encodeText({ v: 1, app: THREE_VERSIONS[qv].bankVersion, code, ts: `2026-10-10T1${qv === "v1" ? 0 : 1}:00:00+09:00`, mode: "a", dur: 1, back: 0, ua: "m",
      rec: [["WB-1-1", "W1-1", "L", 0, 1, 0, 0, 30, "s", ""]], res: null, fb: { cards: [[id, 4, [], sc, ""]] }, qv }, ["x"]);
    const both = cardSummary(parseInput([mk("v1", "a", ["y", "n"]), mk("v2", "b", ["n", ""])].join("\n")).sessions).cards.find(c => c.id === id);
    assert.deepEqual(both.scenes.map(x => [x.label, x.text, x.y, x.n, x.blank]), [
      ["場面1（v1）", PATTERN_BY_ID[id].text.scenes[0], 1, 0, 0], ["場面2（v1）", PATTERN_BY_ID[id].text.scenes[1], 0, 1, 0],
      ["場面1（v2）", SCENES_V2[id][0], 0, 1, 0], ["場面2（v2）", SCENES_V2[id][1], 0, 0, 1]]);
    const only1 = cardSummary(parseInput(mk("v1", "a", ["y", "n"])).sessions).cards.find(c => c.id === id);
    assert.deepEqual(only1.scenes.map(x => [x.label, x.text]), [["場面1", PATTERN_BY_ID[id].text.scenes[0]], ["場面2", PATTERN_BY_ID[id].text.scenes[1]]]);
  } finally { if (injected) delete SCENES_V2[id]; }
});

console.log(fail ? `${fail} failed, ${pass} passed` : `all version3 tests passed (${pass})`);
process.exit(fail ? 1 : 0);
