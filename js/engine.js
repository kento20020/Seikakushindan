// 16次元診断 判定エンジン v2
// - 16傾向スコア（0〜100）から 172 パターン（156本＋弱い版16本）の充足と余裕を計算
// - 「主軸1＋補強1〜2＋矛盾0〜1」の制約つき貪欲選択。各ステップの理由をトレースに残す
// 参照実装: q80/selector_v2.py（Python）。tests/expected_v2.json と一致することを tests/engine.test.mjs で確認。

import { PATTERN_META } from "./data/patterns_meta.js";
import { QUESTIONS } from "./data/questions.js";

export const TH = {
  high: 67,       // 高：この値以上（4問平均3.75以上）
  low: 39,        // 低：この値以下（4問平均2.5以下）
  diff: 15,       // 優勢に必要な左右差
  domMin: 50,     // 優勢側の最低値
  floorRatio: 0.35, // 採用下限（主軸スコアに対する比率）
  shapeN: 12,     // 形状判定に必要な傾向数（16中）
  duelMax: 10,    // 対決だけで得られる優勢余裕の上限
  maxContra: 2,
};

export const DOMAINS = QUESTIONS.domains;           // {1:{name,a,b,letter},...}
export const TRAITS = QUESTIONS.traits;             // 16傾向名（領域順にA,B）
export const PAIR = {}; export const DOM_OF = {};
for (const [d, v] of Object.entries(DOMAINS)) { PAIR[v.a] = v.b; PAIR[v.b] = v.a; DOM_OF[v.a] = +d; DOM_OF[v.b] = +d; }

const mHigh = (v) => v - TH.high;
const mLow = (v) => (TH.low + 1) - v;
const mMid = (v) => Math.min(v - (TH.low + 1), (TH.high - 1) - v);
export const sat = (margin, scale) => margin < 0 ? 0 : 0.4 + 0.6 * Math.min(1, margin / scale);

/** 優勢の余裕。Likertの左右差が小さいときは対決で補完、Likert優勢と対決が逆なら減点 */
export function domMargin(profile, t, log) {
  const v = profile.scores[t], w = profile.scores[PAIR[t]];
  let m = Math.min(v - TH.domMin, (v - w) - TH.diff);
  const duel = profile.duel?.[DOM_OF[t]];
  let note = null;
  if (duel && duel.side) {
    if (m < 0 && v >= TH.domMin && Math.abs(v - w) < TH.diff && duel.side === t && duel.strength > 0) {
      m = Math.min(v - TH.domMin, TH.duelMax * duel.strength / 100);
      note = `対決で補完（${t} ${duel.strength}）`;
    } else if (m >= 0 && duel.side === PAIR[t] && duel.strength > 0) {
      m -= TH.duelMax * duel.strength / 100;
      note = `対決が逆（${PAIR[t]} ${duel.strength}）で減点`;
    }
  }
  if (log && note) log.push(note);
  return m;
}

function basicMargin(profile, d, s) {
  const a = DOMAINS[d].a, b = DOMAINS[d].b;
  const va = profile.scores[a], vb = profile.scores[b];
  const diff = va - vb, small = TH.diff - Math.abs(diff);
  switch (s) {
    case "5": return Math.min(mHigh(va), mHigh(vb), small);
    case "6": return Math.min(mLow(va), mLow(vb), small);
    case "7": return Math.min(small, -Math.min(mHigh(va), mHigh(vb)), -Math.min(mLow(va), mLow(vb)), Math.max(mMid(va), mMid(vb)));
    case "1": return Math.min(mHigh(va), mLow(vb), diff - TH.diff);
    case "3": return Math.min(mHigh(vb), mLow(va), -diff - TH.diff);
    case "2": return Math.min(mHigh(va), vb - (TH.low + 1), diff - TH.diff);
    case "4": return Math.min(mHigh(vb), va - (TH.low + 1), -diff - TH.diff);
    case "1w": return Math.min(mMid(va), mLow(vb), diff - TH.diff);
    case "3w": return Math.min(mMid(vb), mLow(va), -diff - TH.diff);
  }
  throw new Error("state " + s);
}

const STATE_LABEL = { "1": "Aが明確に優勢", "2": "Aが優勢だがBも強い", "3": "Bが明確に優勢", "4": "Bが優勢だがAも強い",
  "5": "両方強い", "6": "両方弱い", "7": "場面による・中間的", "1w": "Aが優勢（弱）", "3w": "Bが優勢（弱）" };

/** 条件を日本語で説明する文字列（ロジック表示用） */
export function describeCondition(meta) {
  const c = meta.cond;
  if (c.type === "basic") {
    const D = DOMAINS[c.d];
    const A = D.a, B = D.b, H = TH.high, L = TH.low, F = TH.diff;
    const m = {
      "1": `${A}≥${H} かつ ${B}≤${L} かつ 差≥${F}`, "3": `${B}≥${H} かつ ${A}≤${L} かつ 差≥${F}`,
      "2": `${A}≥${H} かつ ${B}≥${L + 1} かつ ${A}−${B}≥${F}`, "4": `${B}≥${H} かつ ${A}≥${L + 1} かつ ${B}−${A}≥${F}`,
      "5": `${A}≥${H} かつ ${B}≥${H} かつ 差<${F}`, "6": `${A}≤${L} かつ ${B}≤${L} かつ 差<${F}`,
      "7": `差<${F} で、両方強い・両方弱いのどちらでもない`,
      "1w": `${A}が中（${L + 1}〜${H - 1}） かつ ${B}≤${L} かつ 差≥${F}`, "3w": `${B}が中（${L + 1}〜${H - 1}） かつ ${A}≤${L} かつ 差≥${F}`,
    };
    return `${D.name}：${STATE_LABEL[c.s]}（${m[c.s]}）`;
  }
  if (c.type === "cross") return c.traits.map(t => `優勢:${t}`).join(" かつ ") + `（各${TH.domMin}以上・対より${TH.diff}以上大きい。小差なら対決で補完）`;
  if (c.type === "specialA") return c.clauses.join(" かつ ");
  if (c.type === "specialB") return c.clauses.map(k => k.startsWith("高") ? `${k}（かつ対の傾向以上）` : k).join(" かつ ");
  if (c.type === "specialC") return c.clauses.join(" かつ ") + " かつ 両領域とも左右差<" + TH.diff;
  if (c.type === "shape") return { low: `16傾向のうち${TH.shapeN}以上が≤${TH.low}（回答品質OKのとき）`, high: `16傾向のうち${TH.shapeN}以上が≥${TH.high}（回答品質OKのとき）`,
    mid: `16傾向のうち${TH.shapeN}以上が${TH.low + 1}〜${TH.high - 1}（回答品質OKのとき）`, allA: "8領域すべてでA側が優勢", allB: "8領域すべてでB側が優勢" }[c.which];
  return "";
}

/** 1パターンの余裕（margin）。details に部分条件ごとの余裕を残す */
export function patternMargin(meta, profile, details) {
  const c = meta.cond;
  const push = (label, m) => { if (details) details.push({ label, margin: m }); return m; };
  if (c.type === "basic") return push(describeCondition(meta), basicMargin(profile, c.d, c.s));
  if (c.type === "cross") return Math.min(...c.traits.map(t => { const log = []; const m = domMargin(profile, t, log); return push(`優勢:${t}${log.length ? "／" + log.join("、") : ""}`, m); }));
  if (c.type === "specialA" || c.type === "specialB" || c.type === "specialC") {
    const parts = c.clauses.map(key => {
      const [kind, arg] = key.split(":");
      if (kind === "優勢") { const log = []; const m = domMargin(profile, arg, log); return push(`優勢:${arg}${log.length ? "／" + log.join("、") : ""}`, m); }
      if (kind === "中") return push(`中:${arg}`, mMid(profile.scores[arg]));
      if (kind === "高") {
        if (c.type === "specialB") return push(`高:${arg}（対の${PAIR[arg]}以上）`, Math.min(mHigh(profile.scores[arg]), profile.scores[arg] - profile.scores[PAIR[arg]]));
        return push(`高:${arg}`, mHigh(profile.scores[arg]));
      }
      throw new Error(key);
    });
    if (c.type === "specialC") for (const d of meta.domains) {
      const D = DOMAINS[d]; parts.push(push(`${D.name}の左右差<${TH.diff}`, TH.diff - Math.abs(profile.scores[D.a] - profile.scores[D.b])));
    }
    return Math.min(...parts);
  }
  if (c.type === "shape") {
    const vals = Object.values(profile.rawScores ?? profile.scores);
    if (c.which === "allA" || c.which === "allB") {
      return Math.min(...Object.keys(DOMAINS).map(d => { const t = c.which === "allA" ? DOMAINS[d].a : DOMAINS[d].b; return push(`優勢:${t}`, domMargin(profile, t)); }));
    }
    if (profile.qualityOk === false) return push("回答品質NG（同一回答率>75% または SD<0.75）のため形状判定を保留", -1);
    const pred = { low: v => v <= TH.low, high: v => v >= TH.high, mid: v => v > TH.low && v < TH.high }[c.which];
    const n = vals.filter(pred).length;
    return push(`該当する傾向数 ${n}（必要 ${TH.shapeN}）`, n - TH.shapeN);
  }
  throw new Error(c.type);
}

/** 全パターンを評価。充足したものをスコア順に返す（score = 重要度 × 充足度） */
export function evaluateAll(profile) {
  const hits = [];
  for (const meta of PATTERN_META) {
    const details = [];
    const margin = patternMargin(meta, profile, details);
    if (margin < 0) continue;
    const s = sat(margin, meta.scale);
    const score = meta.importance * s;
    if (score > 0) hits.push({ meta, margin, sat: s, score, details });
  }
  hits.sort((x, y) => y.score - x.score);
  return hits;
}

const isShape = (m) => m.kind === "special" && m.group === "D";

/** 制約つき貪欲選択。trace に各ステップの候補と理由を残す */
export function select(profile, opts = {}) {
  const maxN = opts.maxN ?? 4, minN = opts.minN ?? 2;
  const hits = evaluateAll(profile);
  const chosen = [];
  const usedBasicDomains = new Set(), covered = new Set(), coveredSets = [], usedPairs = new Set();
  const domainCount = {}; let hasShape = false, nContra = 0;
  const trace = [];
  const nonShape = hits.filter(h => !isShape(h.meta));
  const top = nonShape.length ? nonShape[0].score : (hits.length ? hits[0].score : 0);
  const floor = top * TH.floorRatio;

  const subsumed = (doms) => coveredSets.some(set => doms.every(d => set.has(d)));
  const crowd = (meta) => !meta.contra && meta.domains.some(d => (domainCount[d] || 0) >= 2);

  const effective = (h) => {
    const m = h.meta; const reasons = [];
    if (isShape(m)) { if (hasShape) return { value: null, reasons: ["形状は1本まで"] }; return { value: h.score, reasons }; }
    if (m.contra && nContra >= TH.maxContra) return { value: null, reasons: ["矛盾枠は2本まで"] };
    let v = h.score;
    if (m.kind === "basic") {
      const d = m.domains[0];
      if (usedBasicDomains.has(d)) return { value: null, reasons: ["同じ領域の基本解釈を採用済み"] };
      if (m.contra && covered.has(d)) return { value: null, reasons: ["両方強いの重なり（特殊C）などが同領域を覆っている"] };
      if (covered.has(d)) { v *= 0.5; reasons.push("採用済みクロス/特殊が覆う領域 ×0.5"); }
      return { value: v, reasons };
    }
    if (m.kind === "cross") {
      if (usedPairs.has(m.domains.join("-"))) return { value: null, reasons: ["同じ領域ペアのクロスを採用済み"] };
      if (subsumed(m.domains)) return { value: null, reasons: ["採用済みパターンの領域集合に含まれる"] };
      if (m.domains.some(d => covered.has(d))) { v *= 0.8; reasons.push("被覆領域と重なり ×0.8"); }
      if (crowd(m)) { v *= 0.6; reasons.push("同じ領域が既に2本以上 ×0.6"); }
      return { value: v, reasons };
    }
    // special A/B/C
    if (subsumed(m.domains)) return { value: null, reasons: ["採用済みパターンの領域集合に含まれる"] };
    if (m.domains.some(d => covered.has(d))) { v *= 0.8; reasons.push("被覆領域と重なり ×0.8"); }
    if (m.contra && nContra >= 1) { v *= 0.7; reasons.push("矛盾枠2本目 ×0.7"); }
    if (crowd(m)) { v *= 0.6; reasons.push("同じ領域が既に2本以上 ×0.6"); }
    return { value: v, reasons };
  };

  while (chosen.length < maxN) {
    let cands = hits.filter(h => !chosen.includes(h)).map(h => { const e = effective(h); return { h, eff: e.value, reasons: e.reasons }; });
    const step = { k: chosen.length + 1, floor, candidates: cands.slice(0, 12).map(c => ({ id: c.h.meta.id, score: c.h.score, eff: c.eff, reasons: c.reasons })), note: "" };
    cands = cands.filter(c => c.eff !== null);
    if (!cands.length) { step.note = "候補なし"; trace.push(step); break; }
    if (chosen.length === maxN - 1 && nContra === 0) {
      const contras = cands.filter(c => c.h.meta.contra && c.eff >= floor);
      if (contras.length) { cands = contras; step.note = "4本目：矛盾枠が0本なので矛盾候補を優先"; }
    }
    cands.sort((x, y) => y.eff - x.eff);
    const best = cands[0];
    if (chosen.length >= minN && best.eff < floor) { step.note += ` 最良 ${best.h.meta.id} の有効スコア ${best.eff.toFixed(2)} が採用下限 ${floor.toFixed(2)} 未満のため打ち切り`; trace.push(step); break; }
    step.chosen = best.h.meta.id; step.chosenEff = best.eff; trace.push(step);
    chosen.push(best.h);
    const m = best.h.meta;
    if (!isShape(m)) for (const d of m.domains) domainCount[d] = (domainCount[d] || 0) + 1;
    if (m.kind === "basic") usedBasicDomains.add(m.domains[0]);
    else if (m.kind === "cross") { usedPairs.add(m.domains.join("-")); m.domains.forEach(d => covered.add(d)); coveredSets.push(new Set(m.domains)); }
    else if (isShape(m)) hasShape = true;
    else { m.domains.forEach(d => covered.add(d)); coveredSets.push(new Set(m.domains)); }
    if (m.contra) nContra++;
  }
  // 役割：主軸＝最上位の矛盾枠でないパターン。矛盾枠は順位に関係なく「矛盾」
  let mainDone = false;
  for (const h of chosen) {
    if (isShape(h.meta)) h.role = "地（形状）";
    else if (h.meta.contra) h.role = "矛盾";
    else if (!mainDone) { h.role = "主軸"; mainDone = true; }
    else h.role = "補強";
  }
  if (!mainDone) { const f = chosen.find(h => h.role === "矛盾"); if (f) f.role = "主軸"; }
  return { chosen, hits, trace, top, floor };
}

// ---------------------------------------------------------------- 採点
/** 回答（スロットごとの最終回答 1〜5、null=未回答）→ 16傾向スコアと確度 */
export function scoreTraits(slotAnswers) {
  // slotAnswers: { trait: [a1,a2,a3,a4] } 各値 1〜5 または null
  const scores = {}, confidence = {}, informative = {};
  for (const t of TRAITS) {
    const arr = (slotAnswers[t] || []).filter(v => v != null);
    const mean = arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 3;
    scores[t] = (mean - 1) / 4 * 100;
    informative[t] = arr.filter(v => v !== 3).length;
    confidence[t] = arr.length ? informative[t] / 4 : 0;
  }
  return { scores, confidence, informative };
}

/** 対決回答 → {domain: {side, strength}} 。複数回答は平均 */
export function duelFromAnswers(duelAnswers) {
  // duelAnswers: [{domain, sideA, sideB, answer(1..5)}]
  // 設問ごとに a/b の向きが異なる（Q74 は a=熟考、D2x は a=即応 など）ので、
  // 各回答を「領域の正式なA側（DOMAINS[d].a）が正」になるよう揃えてから平均する
  const byDomain = {};
  for (const a of duelAnswers) {
    if (a.answer == null) continue;
    const D = DOMAINS[a.domain];
    let v = (3 - a.answer) * 50;      // +100=sideA ... -100=sideB
    if (a.sideA !== D.a) v = -v;      // sideA が領域のB側なら符号を反転
    (byDomain[a.domain] ||= []).push(v);
  }
  const out = {};
  for (const [d, arr] of Object.entries(byDomain)) {
    const mean = arr.reduce((s, x) => s + x, 0) / arr.length;
    const D = DOMAINS[d];
    out[d] = { side: mean > 0 ? D.a : mean < 0 ? D.b : null, strength: Math.abs(mean), n: arr.length };
  }
  return out;
}

/** 回答品質：同一回答率とSD（基本64問） */
export function responseQuality(values) {
  const vals = values.filter(v => v != null);
  if (!vals.length) return { same: 0, sd: 0, ok: true, n: 0 };
  const counts = {}; for (const v of vals) counts[v] = (counts[v] || 0) + 1;
  const same = Math.max(...Object.values(counts)) / vals.length;
  const mean = vals.reduce((s, v) => s + v, 0) / vals.length;
  const sd = Math.sqrt(vals.reduce((s, v) => s + (v - mean) ** 2, 0) / vals.length);
  return { same, sd, ok: same <= 0.75 && sd >= 0.75, n: vals.length };
}

/** 領域ごとの7状態（基本解釈のどれが充足したか） */
export function domainStates(profile) {
  const out = {};
  for (const d of Object.keys(DOMAINS)) {
    const metas = PATTERN_META.filter(m => m.cond.type === "basic" && m.cond.d === +d);
    let best = null;
    for (const m of metas) { const mg = patternMargin(m, profile); if (mg >= 0 && (!best || mg > best.margin)) best = { meta: m, margin: mg }; }
    out[d] = best ? { state: best.meta.cond.s, label: STATE_LABEL[best.meta.cond.s], id: best.meta.id, margin: best.margin } : { state: null, label: "判定なし", id: null };
  }
  return out;
}

export { STATE_LABEL };
