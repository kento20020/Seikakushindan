// 16次元診断 三択版（左／右／問題を変える）の判定エンジン。仕様：docs/three-choice-logic.md §2〜3
// - 入力は Profile3 = { levels:{傾向:0〜100}, w:{領域:{a,b,n}}, quality:{leftRate, swapCount, skipCount, ok} }
//     levels … X（別領域の行動文どうしの比較）で選ばれた割合 ×100（個人内の相対的な強さ。全員の平均が50付近）
//     w      … W（同じ場面の A行動 vs B行動）で A側／B側を選んだ数
// - 172本のパターンの条件を三択用に読み替えて余裕（margin）を計算し、選択は engine.js の select をそのまま使う
//   （select(profile, { evaluate: evaluateAll3 })）。5択版の engine.js の判定には一切手を入れない。
import { PATTERN_META } from "./data/patterns_meta.js";
import { DOMAINS, TRAITS, PAIR, DOM_OF, STATE_LABEL, sat, select } from "./engine.js";

export const TH3 = { high: 67, low: 39, domShare: 0.6, domDiff: 2, levelFloor: 37.5, tieScale: 12.5 };
/** (取り分 − 0.6) × 125：3:1 → 18.75、4:0 → 50、4:2 → 8.3、5:1 → 29.2 */
export const SHARE_SCALE = 125;
/** S18（相手次第で別人）：左右が拮抗した領域がこの数以上で成立。尺度は 2 */
export const S18_TIE_N = 5;
export const S18_SCALE = 2;
/** 位置バイアス（左ばかり／右ばかり）の警告ライン */
export const LEFT_RATE_HIGH = 0.85, LEFT_RATE_LOW = 0.15;

const HI = TH3.high;          // 高：level ≥ 67
const LO = TH3.low + 1;       // 低：level ≤ 40（式の 40）
const MID_TOP = TH3.high - 1; // 中の上端（式の 66）

/** パターン構造。S18 だけ三択版の尺度（2）に差し替える（重要度・矛盾枠などはそのまま） */
export const META3 = PATTERN_META.map(m => m.id === "S18" ? { ...m, scale: S18_SCALE } : m);
export const META3_BY_ID = Object.fromEntries(META3.map(m => [m.id, m]));

// ---------------------------------------------------------------- 小さな式
const mHigh = (L) => L - HI;
const mLow = (L) => LO - L;
/**
 * 中の上側の余裕。仕様の式は 66 − L だが、追加後の 6分の1刻み（4/6 = 66.7）は「高（≥67）」でも「中（≤66）」でもない
 * 隙間に落ちて、どの状態にも入らない。そこで 66 < L < 67 だけは 0（境目ちょうど＝中）として扱う。
 * 4問刻み（0/25/50/75/100）や 5問刻みでは仕様の式と完全に同じ値になる。
 */
const midTop = (L) => L < HI ? Math.max(MID_TOP - L, 0) : MID_TOP - L;
export const mid3 = (L) => Math.min(L - LO, midTop(L));

const fmt = (v) => v == null || Number.isNaN(v) ? "—" : Number.isInteger(v) ? String(v) : v.toFixed(1);
const level = (p, t) => { const v = p.levels?.[t]; return Number.isFinite(v) ? v : 50; };
const wOf = (p, d) => { const w = p.w?.[d] || {}; const a = +w.a || 0, b = +w.b || 0; return { a, b, n: a + b }; };

/** 「3:1」のような左右の数（A:B の順） */
export function wText(p, d) { const w = wOf(p, d); return `${w.a}:${w.b}`; }

// ---------------------------------------------------------------- 優勢・拮抗
/** 領域 d で傾向 t が左右（W）で優勢である余裕。優勢＝差2以上 かつ 取り分0.6以上。n<2 は未測定（−100） */
export function wMargin(profile3, d, t) {
  const D = DOMAINS[d];
  const { a, b, n } = wOf(profile3, d);
  if (n < 2) return -100;
  const cnt = t === D.a ? a : b, other = n - cnt;
  // (cnt/n − 0.6) × 125 を、浮動小数の誤差が出にくい形で
  let m = (SHARE_SCALE * cnt - SHARE_SCALE * TH3.domShare * n) / n;
  const dcnt = cnt - other;
  if (dcnt < TH3.domDiff) m = Math.min(m, (dcnt - TH3.domDiff) * TH3.tieScale);
  return m;
}

/** 左右の拮抗の余裕：−max(mWA, mWB)。2:2 → 25、3:2 → 12.5、3:1 → −18.75 */
export function tieMargin(profile3, d) {
  const D = DOMAINS[d];
  return -Math.max(wMargin(profile3, d, D.a), wMargin(profile3, d, D.b));
}

/** クロス・特殊で使う優勢：min(wMargin, level − 37.5) */
export function domMargin3(profile3, t) {
  return Math.min(wMargin(profile3, DOM_OF[t], t), level(profile3, t) - TH3.levelFloor);
}

function domLabel(p, t) {
  const d = DOM_OF[t], D = DOMAINS[d], w = wOf(p, d);
  const cnt = t === D.a ? w.a : w.b;
  return `優勢:${t}（左右 ${cnt}:${w.n - cnt}・${t} ${fmt(level(p, t))}）`;
}

// ---------------------------------------------------------------- 基本7状態
export const STATE_ORDER = ["1", "2", "3", "4", "5", "6", "7", "1w", "3w"];

/** 状態 s の部分条件 [{label, margin}]。余裕はその最小値 */
export function basicParts3(p, d, s) {
  const D = DOMAINS[d], A = D.a, B = D.b;
  const LA = level(p, A), LB = level(p, B);
  const mWA = wMargin(p, d, A), mWB = wMargin(p, d, B), tie = -Math.max(mWA, mWB);
  const wt = wText(p, d);
  const P = (label, margin) => ({ label, margin });
  const domA = P(`左右で${A}が優勢（${wt}）`, mWA), domB = P(`左右で${B}が優勢（${wt}）`, mWB);
  const tieP = P(`左右が拮抗（${wt}）`, tie);
  switch (s) {
    case "1": return [domA, P(`${A} ${fmt(LA)} ≥ ${HI}`, mHigh(LA)), P(`${B} ${fmt(LB)} ≤ ${LO}`, mLow(LB))];
    case "2": return [domA, P(`${A} ${fmt(LA)} ≥ ${HI}`, mHigh(LA)), P(`${B} ${fmt(LB)} ≥ ${LO}`, LB - LO)];
    case "1w": return [domA, P(`${A} ${fmt(LA)} が ${HI} 未満`, midTop(LA))];
    case "3": return [domB, P(`${B} ${fmt(LB)} ≥ ${HI}`, mHigh(LB)), P(`${A} ${fmt(LA)} ≤ ${LO}`, mLow(LA))];
    case "4": return [domB, P(`${B} ${fmt(LB)} ≥ ${HI}`, mHigh(LB)), P(`${A} ${fmt(LA)} ≥ ${LO}`, LA - LO)];
    case "3w": return [domB, P(`${B} ${fmt(LB)} が ${HI} 未満`, midTop(LB))];
    case "5": return [tieP, P(`${A} ${fmt(LA)} ≥ ${HI}`, mHigh(LA)), P(`${B} ${fmt(LB)} ≥ ${HI}`, mHigh(LB))];
    case "6": return [tieP, P(`${A} ${fmt(LA)} ≤ ${LO}`, mLow(LA)), P(`${B} ${fmt(LB)} ≤ ${LO}`, mLow(LB))];
    case "7": return [tieP,
      P("両方強い、ではない", -Math.min(mHigh(LA), mHigh(LB))),
      P("両方弱い、ではない", -Math.min(mLow(LA), mLow(LB))),
      P(`どちらかが中（${LO}以上${HI}未満）`, Math.max(mid3(LA), mid3(LB)))];
  }
  throw new Error("state " + s);
}
const minOf = (parts) => Math.min(...parts.map(x => x.margin));

/** 領域 d の状態 s の余裕 */
export function basicMargin3(profile3, d, s) { return minOf(basicParts3(profile3, d, s)); }

// ---------------------------------------------------------------- 条件の説明（ロジック表示用）
const DOM_NOTE = `（左右で差${TH3.domDiff}以上・取り分${TH3.domShare}以上、かつ level≥${TH3.levelFloor}）`;

/** 三択版の条件を日本語で */
export function describeCondition3(meta) {
  const c = meta.cond;
  if (c.type === "basic") {
    const D = DOMAINS[c.d], A = D.a, B = D.b;
    const dom = (t) => `左右で${t}が優勢（差≥${TH3.domDiff}・取り分≥${TH3.domShare}）`;
    const tie = `左右が拮抗（差<${TH3.domDiff} または 取り分<${TH3.domShare}）`;
    const m = {
      "1": `${dom(A)} かつ ${A}≥${HI} かつ ${B}≤${LO}`, "3": `${dom(B)} かつ ${B}≥${HI} かつ ${A}≤${LO}`,
      "2": `${dom(A)} かつ ${A}≥${HI} かつ ${B}≥${LO}`, "4": `${dom(B)} かつ ${B}≥${HI} かつ ${A}≥${LO}`,
      "1w": `${dom(A)} かつ ${A}<${HI}`, "3w": `${dom(B)} かつ ${B}<${HI}`,
      "5": `${tie} かつ ${A}≥${HI} かつ ${B}≥${HI}`, "6": `${tie} かつ ${A}≤${LO} かつ ${B}≤${LO}`,
      "7": `${tie} で、両方強い・両方弱いのどちらでもなく、どちらかが中（${LO}以上${HI}未満）`,
    };
    return `${D.name}：${STATE_LABEL[c.s]}（${m[c.s]}）`;
  }
  if (c.type === "cross") return c.traits.map(t => `優勢:${t}`).join(" かつ ") + DOM_NOTE;
  if (c.type === "specialA") return c.clauses.join(" かつ ") + DOM_NOTE;
  if (c.type === "specialB") return c.clauses.map(k => k.startsWith("高") ? `${k}（≥${HI} かつ対の傾向以上）` : k.startsWith("中") ? `${k}（${LO}以上${HI}未満）` : k).join(" かつ ");
  if (c.type === "specialC") return c.clauses.map(k => `${k}（≥${HI}）`).join(" かつ ") + " かつ 両領域とも左右が拮抗";
  if (c.type === "shape") return {
    low: "三択版では判定しない（X は相対評価なので、全体的に低い・高いは測れない）",
    high: "三択版では判定しない（X は相対評価なので、全体的に低い・高いは測れない）",
    mid: `8領域のうち${S18_TIE_N}領域以上で左右が拮抗（尺度 ${S18_SCALE}）`,
    allA: `8領域すべてで A側が優勢${DOM_NOTE}`, allB: `8領域すべてで B側が優勢${DOM_NOTE}`,
  }[c.which];
  return "";
}

// ---------------------------------------------------------------- パターンの余裕
export const SHAPE_NOT_JUDGED = "相対評価のため全体水準は測れない（三択版では判定しない）";

/** 1パターンの余裕。details に部分条件ごとの余裕を残す */
export function patternMargin3(meta, p, details) {
  const c = meta.cond;
  const push = (label, m) => { if (details) details.push({ label, margin: m }); return m; };
  const dom = (t) => push(domLabel(p, t), domMargin3(p, t));
  if (c.type === "basic") {
    const parts = basicParts3(p, c.d, c.s);
    for (const x of parts) push(x.label, x.margin);
    return minOf(parts);
  }
  if (c.type === "cross") return Math.min(...c.traits.map(dom));
  if (c.type === "specialA" || c.type === "specialB" || c.type === "specialC") {
    const parts = c.clauses.map(key => {
      const [kind, t] = key.split(":");
      if (kind === "優勢") return dom(t);
      if (kind === "中") return push(`中:${t}（${fmt(level(p, t))}）`, mid3(level(p, t)));
      if (kind === "高") {
        const L = level(p, t);
        if (c.type === "specialB") return push(`高:${t}（${fmt(L)}、対の${PAIR[t]} ${fmt(level(p, PAIR[t]))} 以上）`, Math.min(mHigh(L), L - level(p, PAIR[t])));
        return push(`高:${t}（${fmt(L)}）`, mHigh(L));
      }
      throw new Error(key);
    });
    if (c.type === "specialC") for (const d of meta.domains) parts.push(push(`${DOMAINS[d].name}の左右が拮抗（${wText(p, d)}）`, tieMargin(p, d)));
    return Math.min(...parts);
  }
  if (c.type === "shape") {
    if (c.which === "low" || c.which === "high") return push(SHAPE_NOT_JUDGED, -1);
    if (c.which === "mid") {
      const ties = Object.keys(DOMAINS).filter(d => tieMargin(p, d) >= 0);
      return push(`左右が拮抗した領域 ${ties.length}（必要 ${S18_TIE_N}）${ties.length ? "：" + ties.map(d => DOMAINS[d].name).join("・") : ""}`, ties.length - S18_TIE_N);
    }
    if (c.which === "allA" || c.which === "allB") return Math.min(...Object.keys(DOMAINS).map(d => dom(c.which === "allA" ? DOMAINS[d].a : DOMAINS[d].b)));
  }
  throw new Error(c.type + ":" + (c.which || ""));
}

/** 全パターンを評価。充足したもの（余裕≥0）をスコア順に返す。形は engine.js の evaluateAll と同じ */
export function evaluateAll3(profile3) {
  const hits = [];
  for (const meta of META3) {
    const details = [];
    const margin = patternMargin3(meta, profile3, details);
    if (margin < 0) continue;
    const s = sat(margin, meta.scale);
    const score = meta.importance * s;
    if (score > 0) hits.push({ meta, margin, sat: s, score, details });
  }
  hits.sort((x, y) => y.score - x.score);
  return hits;
}

/** 5択版の制約つき貪欲選択をそのまま使う（評価関数だけ三択版に差し替え） */
export function select3(profile3, opts = {}) {
  return select(profile3, { ...opts, evaluate: evaluateAll3 });
}

// ---------------------------------------------------------------- 領域ごとの7状態
/**
 * 領域ごとの状態。{ d: { state, label, id, margin, margins:{s:余裕}, a, b, n, LA, LB, mWA, mWB, tie, lead, check } }
 *   lead  … 左右で優勢な傾向（なければ null）
 *   check … 「要確認」：左右で優勢な側の level が対側より低い（W と X が食い違う）
 */
export function domainStates3(profile3) {
  const out = {};
  for (const d of Object.keys(DOMAINS)) {
    const D = DOMAINS[d];
    const margins = {};
    let best = null;
    for (const s of STATE_ORDER) {
      const m = basicMargin3(profile3, d, s);
      margins[s] = m;
      if (m >= 0 && (!best || m > best.margin)) best = { s, margin: m };
    }
    const w = wOf(profile3, d);
    const LA = level(profile3, D.a), LB = level(profile3, D.b);
    const mWA = wMargin(profile3, d, D.a), mWB = wMargin(profile3, d, D.b);
    const lead = mWA >= 0 ? D.a : mWB >= 0 ? D.b : null;
    const check = lead ? level(profile3, lead) < level(profile3, PAIR[lead]) : false;
    const id = best ? `B${d}-${best.s}` : null;
    out[d] = {
      state: best ? best.s : null, label: best ? STATE_LABEL[best.s] : "判定なし", id, margin: best ? best.margin : null,
      margins, a: w.a, b: w.b, n: w.n, LA, LB, mWA, mWB, tie: -Math.max(mWA, mWB), lead, check,
    };
  }
  return out;
}

// ---------------------------------------------------------------- 回答品質・確度
/**
 * 回答品質（三択版）。records: [{answer:"left"|"right"|null, swaps}]
 * leftRate が 0.85 以上か 0.15 以下なら位置バイアスの警告（ok=false）。形状判定には使わない
 */
export function responseQuality3(records) {
  let left = 0, right = 0, skipCount = 0, swapCount = 0;
  for (const r of records || []) {
    if (r.answer === "left") left++; else if (r.answer === "right") right++; else skipCount++;
    swapCount += r.swaps || 0;
  }
  const n = left + right;
  const leftRate = n ? left / n : null;
  const ok = leftRate == null || !(leftRate >= LEFT_RATE_HIGH || leftRate <= LEFT_RATE_LOW);
  return { leftRate, left, right, n, swapCount, skipCount, ok };
}

/** 確度：領域は n と |a−b|（2以上で優勢が確定）、傾向は X の回答数 m と、level がちょうど50か */
export function confidence3(profile3, m = {}, wins = {}) {
  const domains = {}, traits = {};
  for (const d of Object.keys(DOMAINS)) {
    const w = wOf(profile3, d);
    domains[d] = { n: w.n, diff: Math.abs(w.a - w.b), decided: Math.abs(w.a - w.b) >= TH3.domDiff };
  }
  for (const t of TRAITS) traits[t] = { m: m[t] ?? null, wins: wins[t] ?? null, level: level(profile3, t), even: level(profile3, t) === 50 };
  return { domains, traits };
}

export { STATE_LABEL, DOMAINS, TRAITS, PAIR, DOM_OF };
