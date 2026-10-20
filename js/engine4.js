// 24問版（v4）の採点と結果の文。DOM を使わない（Node のテストでも動く）。決定 U42
// 仕様：docs/diagnosis-v4.md（持ち主の仕様書（2026-10-20）の §6・§7）。三択（engine3.js）・5択（engine.js）の判定には手を入れない。
//
// 3種類の情報を混ぜない（§6.1）：領域 d ごとに
//   a＝R{d}A の 0〜4、b＝R{d}B の 0〜4（普段の自己申告）、p＝P{d} の −2〜＋2（同じ場面での優先の向き）
//   p を a・b に足さない。全員の平均を 50 にそろえない。旧版の勝率・67/39・票の差・0.8 倍・confidence は持ち込まない
//   評定の読み方（表示の区分。集団のデータから出した境目ではない）：0〜1＝当てはまりが少ない、2＝中くらい、3〜4＝多い
//
// 答えの形（js/ui/four_store.js が保存する形）：answers = { R1A: { status: "answered", value: 3 }, P1: { status: "unknown", value: null }, … }
//   キーが無い＝未回答（undefined）。status "unknown"＝判断できない（null）。数でない・範囲の外・整数でない・文字列の数は未回答に戻す
//
//   classifyDomain(a, b, p)   … 仕様書 §6.2 のコードそのまま。"1" "2" "3" "4" "5" "6" "7" "1w" "3w" "incomplete"
//   valueOf(answers, id)      … 数（答えた）／null（判断できない）／undefined（未回答。形が正しくない値も）
//   domainOf(answers, d)      … { domain, a, b, p, state, differentDirections, missing: [{ id, status: "unknown"|"unanswered" }] }
//   computeResult4(answers)   … 結果（下の computeResult4 の説明）。毎回、今の24問の答えから計算し直す
//   stateText4(state, A, B, { differentDirections }) … 状態の見出しと本文（§6.2 の表）
//   prefText4(p, A, B)        … 「A寄り／ややA寄り／同程度／ややB寄り／B寄り」（A・B は傾向の名前）
//   ratingLabel4(v)           … 5段階のラベル（null は「判断できない」、undefined は「未回答」）
//   combinations4(domains, traits) … 既存のパターン（js/data/patterns_meta.js）の条件を v4 の値で読む（§7.2）。最大2件
import { DOMAINS } from "./engine.js";
import { PATTERN_META } from "./data/patterns_meta.js";
import { ITEMS4, QUESTION_ORDER4, QUESTION_BANK_VERSION4, DIAGNOSIS_VERSION4, RATING_CHOICES4 } from "./data/questions4.js";

export const DOMAIN_IDS4 = Object.freeze([1, 2, 3, 4, 5, 6, 7, 8]);
/** 主軸の候補になる状態（§7.1） */
export const CANDIDATE_STATES4 = Object.freeze(["1", "2", "3", "4", "1w", "3w"]);
/** 状態 → 選ばれた側（主軸の候補の状態だけ） */
const LEAD_SIDE = Object.freeze({ 1: "A", 2: "A", "1w": "A", 3: "B", 4: "B", "3w": "B" });
export const leadSide4 = (state) => LEAD_SIDE[state] ?? null;
/** 組み合わせの最大数（§7.2） */
export const MAX_COMBOS4 = 2;
/** 主軸のあとの補足の最大数（§7.1） */
export const MAX_SUPPORTING4 = 2;

// ---------------------------------------------------------------- 値の確かめ
/** R の値：0〜4 の整数（数の型だけ。"3" のような文字列は認めない） */
export const isRating4 = (v) => typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 4;
/** P の値：−2〜＋2 の整数 */
export const isPref4 = (v) => typeof v === "number" && Number.isInteger(v) && v >= -2 && v <= 2;
/** 設問 id の値として正しいか（知らない id は false） */
export function validValue4(id, v) {
  const it = ITEMS4[id];
  if (!it) return false;
  return it.kind === "R" ? isRating4(v) : isPref4(v);
}

/** 1問の答え：数（答えた）／null（判断できない）／undefined（未回答・形が正しくない） */
export function valueOf(answers, id) {
  const x = answers && typeof answers === "object" ? answers[id] : undefined;
  if (!x || typeof x !== "object") return undefined;
  if (x.status === "unknown" && x.value === null) return null;
  if (x.status === "answered" && validValue4(id, x.value)) return x.value;
  return undefined;
}

// ---------------------------------------------------------------- 領域の状態（§6.2。コードは仕様書のまま）
export function classifyDomain(a, b, p) {
  if (a === null || b === null || p === null) return "incomplete";
  if (a <= 1 && b <= 1) return "6";
  const differentDirections = p * (a - b) < 0 && Math.abs(a - b) >= 2;
  if (differentDirections) return "7";
  if (a >= 3 && b >= 3) return p > 0 ? "2" : p < 0 ? "4" : "5";
  if (p > 0) {
    if (a >= 3) return b <= 1 ? "1" : "2";
    return a === 2 ? "1w" : "7";
  }
  if (p < 0) {
    if (b >= 3) return a <= 1 ? "3" : "4";
    return b === 2 ? "3w" : "7";
  }
  return "7";
}

/** 表示用の印（§6.2）：普段の傾向（a・b）と場面の選択（p）の向きが2段階以上ちがう。不正・矛盾・精度の低さの意味ではない */
export function differentDirections4(a, b, p) {
  if (a === null || b === null || p === null) return false;
  return p * (a - b) < 0 && Math.abs(a - b) >= 2;
}

const IDS_OF = (d) => ({ a: `R${d}A`, b: `R${d}B`, p: `P${d}` });

/** 領域 d の値と状態。null と未回答は missing の status で分ける（どちらも状態は incomplete。埋め合わせない） */
export function domainOf(answers, d) {
  const ids = IDS_OF(d);
  const raw = { a: valueOf(answers, ids.a), b: valueOf(answers, ids.b), p: valueOf(answers, ids.p) };
  const a = raw.a ?? null, b = raw.b ?? null, p = raw.p ?? null;
  const missing = ["a", "b", "p"].filter((k) => raw[k] == null)
    .map((k) => ({ id: ids[k], status: raw[k] === null ? "unknown" : "unanswered" }));
  return { domain: d, a, b, p, state: classifyDomain(a, b, p), differentDirections: differentDirections4(a, b, p), missing };
}

// ---------------------------------------------------------------- 結果
/** 16傾向の名前（領域順に A, B） */
export const TRAITS4 = Object.freeze(DOMAIN_IDS4.flatMap((d) => [DOMAINS[d].a, DOMAINS[d].b]));
/** 傾向の名前 → { domain, side } */
export const TRAIT_SIDE4 = Object.freeze(Object.fromEntries(DOMAIN_IDS4.flatMap((d) => [
  [DOMAINS[d].a, Object.freeze({ domain: d, side: "A" })],
  [DOMAINS[d].b, Object.freeze({ domain: d, side: "B" })],
])));

/** 主軸の候補の並べ方（§7.1）：選ばれた側の評定 → |p| → |a−b| の大きい順、同じなら領域の番号順。表示の並べ方で、統計的な重要度ではない */
export function rankCandidates4(domains) {
  const list = DOMAIN_IDS4.map((d) => domains[d]).filter((x) => x && CANDIDATE_STATES4.includes(x.state));
  const own = (x) => (leadSide4(x.state) === "A" ? x.a : x.b);
  return list.sort((x, y) => (own(y) - own(x))
    || (Math.abs(y.p) - Math.abs(x.p))
    || (Math.abs(y.a - y.b) - Math.abs(x.a - x.b))
    || (x.domain - y.domain));
}

/**
 * 冒頭の見出しの種類（§7.1）
 *   primary  … 主軸の候補がある（見出しは主軸の領域の状態の見出し）
 *   multiple … 候補が無く、状態5（どちらの傾向もある）の領域がある →『複数の傾向を持つ』
 *   flat     … 完全に答えた領域はあるが、候補も状態5も無い →『今回の回答では、片側に強く寄らない傾向』
 *   none     … 完全に答えた領域が0 → 総合の見出しを作らない（分かっている個別の回答と相談への入口だけ）
 */
export const LEAD_TITLE4 = Object.freeze({ multiple: "複数の傾向を持つ", flat: "今回の回答では、片側に強く寄らない傾向" });

/**
 * 24問の今の答えから結果を作る（前の結果は使い回さない。§8.2）
 *   { diagnosisVersion: "v4", questionBankVersion,
 *     traits: { 傾向の名前: { rating: 0〜4 | null, displayValue: 0|25|50|75|100 | null } },   // displayValue は rating×25 の線形の表示。確率・偏差値・百分位ではない
 *     domains: { 1: { domain, a, b, p, state, differentDirections, missing }, … },
 *     primaryDomainId: 1〜8 | null, supportingDomainIds: [最大2],
 *     lead: "primary" | "multiple" | "flat" | "none",
 *     completeDomainIds: [...], multipleDomainIds: [状態5の領域],
 *     combos: [{ id, kind, group, domains, traits, text }]（最大2。§7.2）,
 *     patternIds: [基本の構造上の ID「B{領域}-{状態}」（完全に答えた領域だけ）…, 組み合わせの ID …],
 *     counts: { answered, unknown, unanswered } }
 *   confidence は作らない
 */
export function computeResult4(answers) {
  const domains = {};
  for (const d of DOMAIN_IDS4) domains[d] = domainOf(answers, d);
  const traits = {};
  for (const d of DOMAIN_IDS4) {
    for (const side of ["A", "B"]) {
      const v = side === "A" ? domains[d].a : domains[d].b;
      traits[side === "A" ? DOMAINS[d].a : DOMAINS[d].b] = { rating: v, displayValue: v === null ? null : v * 25 };
    }
  }
  const complete = DOMAIN_IDS4.filter((d) => domains[d].state !== "incomplete");
  const ranked = rankCandidates4(domains);
  const multiple = complete.filter((d) => domains[d].state === "5");
  const lead = ranked.length ? "primary" : multiple.length ? "multiple" : complete.length ? "flat" : "none";
  const combos = combinations4(domains, traits);
  let answered = 0, unknown = 0;
  for (const id of QUESTION_ORDER4) {
    const v = valueOf(answers, id);
    if (v === null) unknown++; else if (v !== undefined) answered++;
  }
  return {
    diagnosisVersion: DIAGNOSIS_VERSION4,
    questionBankVersion: QUESTION_BANK_VERSION4,
    traits,
    domains,
    primaryDomainId: ranked[0]?.domain ?? null,
    supportingDomainIds: ranked.slice(1, 1 + MAX_SUPPORTING4).map((x) => x.domain),
    lead,
    completeDomainIds: complete,
    multipleDomainIds: multiple,
    combos,
    patternIds: [...complete.map((d) => `B${d}-${domains[d].state}`), ...combos.map((c) => c.id)],
    counts: { answered, unknown, unanswered: QUESTION_ORDER4.length - answered - unknown },
  };
}

// ---------------------------------------------------------------- 組み合わせ（§7.2。既存のパターンの条件を v4 の値で読む）
const isComplete = (dom) => !!dom && dom.state !== "incomplete";
const ratingOf = (traits, t) => {
  const v = traits?.[t]?.rating;
  return isRating4(v) ? v : null;
};

/** 優勢:t（cross の traits も同じ）：完全に答えた領域で、p が t の側、t の評定が3以上かつ反対側以上、differentDirections でない。1w/3w は成立させない */
export function dominant4(domains, t) {
  const ts = TRAIT_SIDE4[t];
  if (!ts) return false;
  const dom = domains?.[ts.domain];
  if (!isComplete(dom) || dom.differentDirections || dom.state === "1w" || dom.state === "3w") return false;
  const pSide = dom.p > 0 ? "A" : dom.p < 0 ? "B" : null;
  if (pSide !== ts.side) return false;
  const own = ts.side === "A" ? dom.a : dom.b, other = ts.side === "A" ? dom.b : dom.a;
  return own >= 3 && own >= other;
}

/** 条件の1つ（"優勢:t" "高:t" "中:t" "低:t"）が成り立つか。欠けた値を含む条件は成り立たない。比較の相手や全体の平均で補正しない */
export function clause4(domains, traits, clause) {
  const [kind, t] = String(clause).split(":");
  if (!TRAIT_SIDE4[t]) return false;
  if (kind === "優勢") return dominant4(domains, t);
  const r = ratingOf(traits, t);
  if (r === null) return false;
  if (kind === "高") return r >= 3;
  if (kind === "中") return r === 2;
  if (kind === "低") return r <= 1;
  return false;
}

const traitOfClause = (c) => String(c).split(":")[1];

/** パターン1本が v4 の候補になるか。なるなら、条件で挙がった傾向の名前の並び。ならなければ null */
function candidateTraits(m, domains, traits) {
  const c = m.cond || {};
  const allDomainsComplete = (m.domains || []).every((d) => isComplete(domains[d]));
  switch (c.type) {
    case "cross":
      return (c.traits || []).every((t) => dominant4(domains, t)) ? c.traits.slice() : null;
    case "specialA":
    case "specialB":
      // specialB の旧版の追加条件（「反対側以上」など）は引き継がない
      return allDomainsComplete && (c.clauses || []).every((x) => clause4(domains, traits, x)) ? c.clauses.map(traitOfClause) : null;
    case "specialC":
      // 関係する領域がすべて完全に答えてあり、p＝0（同じくらい）のときだけ。名前は「あわせて見られる傾向」。矛盾とは呼ばない
      return allDomainsComplete && (m.domains || []).every((d) => domains[d].p === 0)
        && (c.clauses || []).every((x) => clause4(domains, traits, x)) ? c.clauses.map(traitOfClause) : null;
    case "shape": {
      // low・high・mid は総合の性格の見出しとして使わない。allA・allB は8領域すべて完全に答えて、それぞれの側の「優勢」があるときだけ
      if (c.which !== "allA" && c.which !== "allB") return null;
      const side = c.which === "allA" ? "a" : "b";
      const names = DOMAIN_IDS4.map((d) => DOMAINS[d][side]);
      return DOMAIN_IDS4.every((d) => isComplete(domains[d])) && names.every((t) => dominant4(domains, t)) ? names : null;
    }
    default:
      return null;   // basic は領域ごとの状態（B{領域}-{状態}）として別に扱う
  }
}

/** 「「X」と「Y」」「「X」「Y」と「Z」」 */
export function traitList4(names) {
  const q = names.map((n) => `「${n}」`);
  if (q.length <= 1) return q.join("");
  return `${q.slice(0, -1).join("")}と${q[q.length - 1]}`;
}

/** 組み合わせの短い文（既存の文章の代わりに、事実に沿った短い文。§7.2） */
export const comboText4 = (names) => `${traitList4(names)}があわせて見られます。`;

/**
 * 組み合わせ（最大2件）：既存の重要度の大きい順、同じなら ID の順。同じ domains の集合の候補は1件だけ
 *   主軸は §7.1 の基本の結果から選び、組み合わせで上書きしない
 *   → [{ id, kind, group, domains, traits: [傾向の名前…], text }]
 */
export function combinations4(domains, traits, meta = PATTERN_META) {
  const cands = [];
  for (const m of meta) {
    if (m.kind === "basic") continue;
    const names = candidateTraits(m, domains, traits);
    if (names) cands.push({ m, names });
  }
  cands.sort((x, y) => (y.m.importance - x.m.importance) || (x.m.id < y.m.id ? -1 : x.m.id > y.m.id ? 1 : 0));
  const seen = new Set();
  const out = [];
  for (const { m, names } of cands) {
    const key = [...m.domains].sort((x, y) => x - y).join(",");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ id: m.id, kind: m.kind, group: m.group ?? null, domains: m.domains.slice(), traits: names, text: comboText4(names) });
    if (out.length >= MAX_COMBOS4) break;
  }
  return out;
}

// ---------------------------------------------------------------- 文（§6.2 の表）
const q = (n) => `「${n}」`;
/** 状態7で differentDirections のときだけの本文 */
export const DIFFERENT_DIRECTIONS_TEXT4 = "普段の傾向と今回の場面で選んだ行動に違いがありました。一方だけに決めず、両方の回答を残しています。";

/** 状態の見出し（title）と本文（body）。A・B は傾向の名前（例「向き合う」「距離を取る」） */
export function stateText4(state, A, B, { differentDirections = false } = {}) {
  switch (String(state)) {
    case "1": return { title: `${q(A)}を選びやすい`, body: `普段の回答では${q(A)}の当てはまりが多く、今回の場面でも${q(A)}を選ぶ傾向が見られます。` };
    case "2": return { title: `${q(A)}を先に選び、${q(B)}も持つ`, body: `今回の場面では${q(A)}寄りですが、普段の回答には${q(B)}の傾向もあります。` };
    case "3": return { title: `${q(B)}を選びやすい`, body: `普段の回答では${q(B)}の当てはまりが多く、今回の場面でも${q(B)}を選ぶ傾向が見られます。` };
    case "4": return { title: `${q(B)}を先に選び、${q(A)}も持つ`, body: `今回の場面では${q(B)}寄りですが、普段の回答には${q(A)}の傾向もあります。` };
    case "5": return { title: "どちらの傾向もある", body: `普段の回答では、${q(A)}と${q(B)}の両方の当てはまりが多く、今回の場面では優先差がありませんでした。` };
    case "6": return { title: "どちらも強くは当てはまらない", body: `今回の普段の自己申告では、${q(A)}と${q(B)}のどちらも当てはまりは少なめでした。` };
    case "7": return {
      title: "片側だけにはまとまらない",
      body: differentDirections ? DIFFERENT_DIRECTIONS_TEXT4 : `今回の回答では、${q(A)}か${q(B)}のどちらか一方だけには整理しきれませんでした。`,
    };
    case "1w": return { title: `${q(A)}をやや選びやすい`, body: `場面の選択は${q(A)}寄りですが、普段の当てはまりは中程度でした。` };
    case "3w": return { title: `${q(B)}をやや選びやすい`, body: `場面の選択は${q(B)}寄りですが、普段の当てはまりは中程度でした。` };
    default: return { title: "この領域はまだ分かりません", body: "判断できない項目があるため、この領域の組み合わせは判定していません。" };
  }
}

/** 領域の結果（domains[d]）から見出しと本文 */
export function domainText4(dom) {
  const D = DOMAINS[dom?.domain];
  if (!D) return null;
  return stateText4(dom.state, D.a, D.b, { differentDirections: !!dom.differentDirections });
}

/** p の補足（§6.2）。A・B は傾向の名前。null は「判断できない」、undefined は「未回答」 */
export function prefText4(p, A, B) {
  if (p === null) return "判断できない";
  if (!isPref4(p)) return "未回答";
  return p === 2 ? `${A}寄り` : p === 1 ? `やや${A}寄り` : p === 0 ? "同程度" : p === -1 ? `やや${B}寄り` : `${B}寄り`;
}

/** 評定のラベル。null は「判断できない」、それ以外の正しくない値は「未回答」 */
export function ratingLabel4(v) {
  if (v === null) return "判断できない";
  return isRating4(v) ? RATING_CHOICES4[v].label : "未回答";
}
