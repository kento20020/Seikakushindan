// 24問版（v4）の採点と結果の文。DOM を使わない（Node のテストでも動く）。決定 U44（U42 の当てはまり度の採点を置き換えた）
// 仕様：docs/diagnosis-v4.md §5・§6。三択（engine3.js）・5択（engine.js）の判定には手を入れない。
//
// どの問も A（＋1）か B（−1）の2択。領域 d ごとに3問（U{d}・P{d}・N{d}）の答えを数える：
//   n＝答えた数（判断できないは数えない）、a＝A の数、b＝B の数、share＝A の割合（a / n を % にして四捨五入：100・67・50・33・0）
//   状態（state）：
//     incomplete … n が 2 より少ない（判断できない問が多い）
//     strongA    … b＝0（2問か3問とも A）        → 見出し「「A」を選びやすい」
//     leanA      … a＞b かつ b＞0                → 「「A」寄り」
//     mid        … a＝b                          → 「どちらか一方には寄らない」
//     leanB・strongB … A と対称
//   違いの印（differentDirections）：U の答えがあり、P と N の答えが両方あって同じ向きで、U と逆のとき。本文の後ろに1文を足すだけ（減点しない）
//   旧版の勝率・67/39・票の差・0.8 倍・confidence・172パターンの組み合わせは使わない
//
// 答えの形（js/ui/four_store.js が保存する形）：answers = { U1: { status: "answered", value: 1 }, P2: { status: "unknown", value: null }, … }
//   キーが無い＝未回答（undefined）。status "unknown"＝判断できない（null）。1・−1 以外の値（数でない・文字列・範囲の外）は未回答に戻す
//
//   valueOf(answers, id)      … 1（A）／−1（B）／null（判断できない）／undefined（未回答。形が正しくない値も）
//   domainOf(answers, d)      … { domain, picks: { U, P, N }, n, a, b, share, state, differentDirections, missing }
//   computeResult4(answers)   … 結果（下の computeResult4 の説明）。毎回、今の24問の答えから計算し直す
//   rankCandidates4(domains)  … 主軸と補足の候補の並び（強 → 寄り、同じなら答えた数 n が多い方、さらに同じなら領域の番号順）
//   domainText4(dom)          … 状態の見出しと本文
//   leadSide4(state)          … 状態 → 選ばれた側（"A" | "B" | null）
import { DOMAINS } from "./engine.js";
import { ITEMS4, QUESTION_ORDER4, QUESTION_BANK_VERSION4, DIAGNOSIS_VERSION4, idsOfDomain4 } from "./data/questions4.js";

export const DOMAIN_IDS4 = Object.freeze([1, 2, 3, 4, 5, 6, 7, 8]);
/** 状態の名前（コード → 日本語。文書・テスト用） */
export const STATE_LABEL4 = Object.freeze({ strongA: "A強", leanA: "A寄り", mid: "まんなか", leanB: "B寄り", strongB: "B強", incomplete: "incomplete" });
/** 主軸の候補になる状態（強と寄り） */
export const CANDIDATE_STATES4 = Object.freeze(["strongA", "leanA", "leanB", "strongB"]);
const LEAD_SIDE = Object.freeze({ strongA: "A", leanA: "A", leanB: "B", strongB: "B" });
const STRENGTH = Object.freeze({ strongA: 2, strongB: 2, leanA: 1, leanB: 1 });
export const leadSide4 = (state) => LEAD_SIDE[state] ?? null;
/** 強さ（強＝2、寄り＝1、ほか＝0）。相談への入口（強＝高め・寄り＝低め）でも使う */
export const strength4 = (state) => STRENGTH[state] ?? 0;
/** 主軸のあとの補足の最大数 */
export const MAX_SUPPORTING4 = 2;
/** 領域の状態を出すのに要る、答えた数の最小 */
export const MIN_ANSWERED4 = 2;

// ---------------------------------------------------------------- 値の確かめ
/** 答えの値：1（A）か −1（B）だけ（数の型だけ。"1" のような文字列は認めない） */
export const isAnswer4 = (v) => v === 1 || v === -1;
/** 設問 id の値として正しいか（知らない id は false） */
export function validValue4(id, v) {
  return !!ITEMS4[id] && isAnswer4(v);
}

/** 1問の答え：1（A）／−1（B）／null（判断できない）／undefined（未回答・形が正しくない） */
export function valueOf(answers, id) {
  const x = answers && typeof answers === "object" ? answers[id] : undefined;
  if (!x || typeof x !== "object") return undefined;
  if (x.status === "unknown" && x.value === null) return null;
  if (x.status === "answered" && validValue4(id, x.value)) return x.value;
  return undefined;
}

const pickOf = (v) => (v === 1 ? "A" : v === -1 ? "B" : v === null ? "unknown" : "unanswered");

// ---------------------------------------------------------------- 領域の状態
/** a（A の数）・b（B の数）から状態 */
export function classifyDomain4(a, b) {
  const n = a + b;
  if (n < MIN_ANSWERED4) return "incomplete";
  if (b === 0) return "strongA";
  if (a === 0) return "strongB";
  if (a > b) return "leanA";
  if (b > a) return "leanB";
  return "mid";
}

/** 違いの印：U の答えがあり、P と N の答えが両方あって同じ向きで、U と逆 */
export function differentDirections4(u, p, nn) {
  return isAnswer4(u) && isAnswer4(p) && isAnswer4(nn) && p === nn && u !== p;
}

/** 領域 d の答えと状態。判断できない（unknown）と未回答（unanswered）は missing の status で分ける（どちらも数えない。埋め合わせない） */
export function domainOf(answers, d) {
  const ids = idsOfDomain4(d);
  const v = { U: valueOf(answers, ids.U), P: valueOf(answers, ids.P), N: valueOf(answers, ids.N) };
  const vals = [v.U, v.P, v.N];
  const a = vals.filter((x) => x === 1).length;
  const b = vals.filter((x) => x === -1).length;
  const n = a + b;
  const missing = ["U", "P", "N"].filter((k) => !isAnswer4(v[k])).map((k) => ({ id: ids[k], status: v[k] === null ? "unknown" : "unanswered" }));
  return {
    domain: d,
    picks: { U: pickOf(v.U), P: pickOf(v.P), N: pickOf(v.N) },
    n, a, b,
    share: n ? Math.round((a / n) * 100) : null,
    state: classifyDomain4(a, b),
    differentDirections: differentDirections4(v.U, v.P, v.N),
    missing,
  };
}

// ---------------------------------------------------------------- 結果
/** 主軸と補足の候補の並べ方：強（A強・B強）が先、次に寄り。同じなら答えた数 n が多い方、さらに同じなら領域の番号順。表示の並べ方で、統計的な重要度ではない */
export function rankCandidates4(domains) {
  return DOMAIN_IDS4.map((d) => domains[d]).filter((x) => x && CANDIDATE_STATES4.includes(x.state))
    .sort((x, y) => (strength4(y.state) - strength4(x.state)) || (y.n - x.n) || (x.domain - y.domain));
}

/**
 * 冒頭の見出しの種類
 *   primary … 主軸の候補（強か寄りの領域）がある（見出しは主軸の領域の状態の見出し）
 *   flat    … 状態の出た領域はあるが、どれも「まんなか」→『今回の回答では、片側に強く寄らない傾向』
 *   none    … どの領域も incomplete → 総合の見出しを作らない（分かっている個別の回答と相談への入口だけ）
 */
export const LEAD_TITLE4 = Object.freeze({ flat: "今回の回答では、片側に強く寄らない傾向" });

/**
 * 24問の今の答えから結果を作る（前の結果は使い回さない）
 *   { diagnosisVersion: "v4", questionBankVersion,
 *     domains: { 1: { domain, picks, n, a, b, share, state, differentDirections, missing }, … },
 *     primaryDomainId: 1〜8 | null, supportingDomainIds: [最大2],
 *     lead: "primary" | "flat" | "none", completeDomainIds: [...],
 *     counts: { answered, unknown, unanswered } }
 *   confidence・組み合わせのパターンは作らない
 */
export function computeResult4(answers) {
  const domains = {};
  for (const d of DOMAIN_IDS4) domains[d] = domainOf(answers, d);
  const complete = DOMAIN_IDS4.filter((d) => domains[d].state !== "incomplete");
  const ranked = rankCandidates4(domains);
  const lead = ranked.length ? "primary" : complete.length ? "flat" : "none";
  let answered = 0, unknown = 0;
  for (const id of QUESTION_ORDER4) {
    const v = valueOf(answers, id);
    if (v === null) unknown++; else if (v !== undefined) answered++;
  }
  return {
    diagnosisVersion: DIAGNOSIS_VERSION4,
    questionBankVersion: QUESTION_BANK_VERSION4,
    domains,
    primaryDomainId: ranked[0]?.domain ?? null,
    supportingDomainIds: ranked.slice(1, 1 + MAX_SUPPORTING4).map((x) => x.domain),
    lead,
    completeDomainIds: complete,
    counts: { answered, unknown, unanswered: QUESTION_ORDER4.length - answered - unknown },
  };
}

// ---------------------------------------------------------------- 文
const q = (n) => `「${n}」`;
/** 違いの印があるときに本文の後ろに足す文（決めつけない・減点しない） */
export const DIFFERENT_DIRECTIONS_TEXT4 = "普段の自分と、場面で選んだ行動に違いがありました。";

/** 状態の見出し（title）と本文（body）。A・B は傾向の名前（例「向き合う」「距離を取る」）。n・a・b は答えた数・A の数・B の数 */
export function stateText4(state, A, B, { n = 0, a = 0, b = 0, differentDirections = false } = {}) {
  const tail = differentDirections ? DIFFERENT_DIRECTIONS_TEXT4 : "";
  switch (String(state)) {
    case "strongA": return { title: `${q(A)}を選びやすい`, body: `${n}問とも${q(A)}を選びました。${tail}` };
    case "leanA": return { title: `${q(A)}寄り`, body: `${n}問のうち${a}問で${q(A)}を選びました。${tail}` };
    case "mid": return { title: "どちらか一方には寄らない", body: `${q(A)}と${q(B)}を同じ数だけ選びました。${tail}` };
    case "leanB": return { title: `${q(B)}寄り`, body: `${n}問のうち${b}問で${q(B)}を選びました。${tail}` };
    case "strongB": return { title: `${q(B)}を選びやすい`, body: `${n}問とも${q(B)}を選びました。${tail}` };
    default: return { title: "この領域はまだ分かりません", body: "判断できない問が多いため、この領域は出していません。" };
  }
}

/** 領域の結果（domains[d]）から見出しと本文 */
export function domainText4(dom) {
  const D = DOMAINS[dom?.domain];
  if (!D) return null;
  return stateText4(dom.state, D.a, D.b, { n: dom.n, a: dom.a, b: dom.b, differentDirections: !!dom.differentDirections });
}
