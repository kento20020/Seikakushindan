// 24問版（v4）の結果の文を選ぶ（持ち主の原稿の形：タイトル1つ・本文・補足0〜1文・相手に伝える一言）。決定 U46
// DOM を使わない（Node のテストでも動く）。文は js/data/result_copy4.js（原稿の写し）。仕様：docs/diagnosis-v4.md §6
// 24問の問い・保存・js/engine4.js の判定（A強など・primaryDomainId）は変えない。ここは computeResult4 の結果を読むだけ
//
// 1. 領域ごとの原稿の状態（copyStateOf4。engine4 の domainOf の n・a・b・differentDirections から）
//      答えが1問以下（n＜2）                         → "incomplete"
//      普段（U）と、同じ向きの場面（P・N）が逆        → "7dd"（状態7。専用の文）
//      3問とも A → "1"、3問とも B → "3"、3問のうち A が2問 → "2"、B が2問 → "4"
//      2問だけ答えて2問とも A → "1w"、2問とも B → "3w"、A と B が1問ずつ → "7"
//      状態5・6は2択では出ない（文はデータとして持つ）
// 2. 主軸（primaryOf4）：状態 1・2・3・4・1w・3w の領域。1／3 → 2／4 → 1w／3w → 領域の番号の小さい順の先頭
//      選ばれた側：1・2・1w → A、3・4・3w → B
// 3. 本文：主軸の領域の B{d}-{状態}。一言：主軸の選ばれた側の一言（SIDE_COPY4）
//    特別の組 PAIR-7B-8B：領域7と8がどちらも B 側（状態3か4）で、主軸が7か8 → 題・本文2段落・一言を丸ごと置き換える（補足なし）
// 4. 補足（0〜1文）：主軸以外で状態 1・2・3・4 の領域を、主軸と同じ並びで見て、最初に合うもの1つ
//      主軸の印（claimTags）：1・1w → A のテーマ、3・3w → B のテーマ、2・4（・5）→ A と B の両方のテーマ
//      候補の側のテーマが主軸の印と同じか、同じ組（THEME_GROUPS4）なら飛ばす
//      本文＋補足＋一言の字数が COPY_MAX_CHARS4（260）を超えるときは補足を外す（本文は切らない）
// 5. 主軸が無いとき：状態5の領域がある → mixed／答えがそろった領域はある（7・7dd だけ）→ hold／1つも無い → none（補足・一言なし）
//
//   resultCopy4(r)        … { copyVersion, copyId, kind, primaryDomain, side, title, paragraphs, bridge, bridgeDomain, action, claimTags }
//                            kind："primary" | "pair" | "mixed" | "hold" | "none"。中の ID（copyId・claimTags）は画面に出さない
//   copyStateOf4(dom)     … 領域の原稿の状態（上の1）
//   copyStatesOf4(r)      … { 1: "1", 2: "7", … }（8領域）
//   primaryOf4(states)    … { domain, state, side } | null
//   claimTagsOf4(d, st)   … 主軸の印
//   sameTheme4(t, tags)   … テーマ t が tags と同じか、同じ組か
//   domainCopy4(d, st)    … 領域ごとの文 { id, title, body }（7dd は専用の文、incomplete は未回答の文）。標準の画面には並べない
//   copyChars4(copy)      … 本文＋補足＋一言の字数
//   firstSentence4(text)  … 最初の1文（「」の中では切らない）
//
// ■ 三択（80問）とも共有する組み立て（決定 U49。js/result_copy3.js が使う）
//   resultCopyFromStates(states, opts) … 状態の表 { 1: "1", … } から結果の文を1セット（上の2〜5）。resultCopy4 はこれを呼ぶだけ
//     opts.order(x, y)     … 同じ段（1／3 → 2／4 → 1w／3w）の中の並べ方（主軸と補足の候補の両方）。既定は領域の番号の順（24問）
//     opts.bridgeOk(d, st) … 補足の候補にしてよいか（既定はどれも可）
//     opts.pairOk(states)  … 特別の組 PAIR-7B-8B にしてよいか（既定は可。領域7・8が B 側で主軸が7か8、の条件は共通）
//     opts.copyVersion     … 出力の copyVersion（既定 RESULT_COPY_VERSION4。三択は "result-v3.1"）
//     opts.maxChars        … 字数の上限（既定 260）
//   24問は opts を渡さないので、出力は U46 のまま（tests/result_copy4.test.mjs）
import { DOMAIN_IDS4 } from "./engine4.js";
import {
  RESULT_COPY_VERSION4, DOMAIN_COPY4, SIDE_COPY4, THEME_GROUPS4, PAIR_7B_8B, OVERALL_COPY4,
  DIFFERENT_DIRECTIONS_COPY4, UNANSWERED_COPY4,
} from "./data/result_copy4.js";

/** 本文＋補足＋一言の字数の上限（超えたら補足を外す） */
export const COPY_MAX_CHARS4 = 260;
/** 主軸の候補の状態 */
export const PRIMARY_STATES4 = Object.freeze(["1", "2", "3", "4", "1w", "3w"]);
/** 補足の候補の状態（3問とも答えていて、向きの違いが無い） */
export const BRIDGE_STATES4 = Object.freeze(["1", "2", "3", "4"]);

const TIER = Object.freeze({ 1: 0, 3: 0, 2: 1, 4: 1, "1w": 2, "3w": 2 });
const SIDE_OF = Object.freeze({ 1: "A", 2: "A", "1w": "A", 3: "B", 4: "B", "3w": "B" });
const B_SIDE = new Set(["3", "4"]);

/** 状態 → 選ばれた側（"A" | "B" | null） */
export const copySide4 = (state) => SIDE_OF[state] ?? null;

const count = (x) => (Number.isInteger(x) && x >= 0 && x <= 3 ? x : null);

/** 領域の原稿の状態（domainOf の n・a・b・differentDirections から）。形の合わない値は incomplete */
export function copyStateOf4(dom) {
  if (!dom || typeof dom !== "object") return "incomplete";
  const a = count(dom.a), b = count(dom.b);
  if (a === null || b === null) return "incomplete";
  const n = a + b;
  if (n < 2 || n > 3) return "incomplete";
  if (dom.differentDirections === true) return "7dd";
  if (n === 3) {
    if (a === 3) return "1";
    if (b === 3) return "3";
    return a === 2 ? "2" : "4";
  }
  if (a === 2) return "1w";
  if (b === 2) return "3w";
  return "7";
}

/** 8領域の原稿の状態 { 1: "1", … } */
export function copyStatesOf4(r) {
  const doms = r && typeof r === "object" && r.domains && typeof r.domains === "object" ? r.domains : {};
  return Object.fromEntries(DOMAIN_IDS4.map((d) => [d, copyStateOf4(doms[d])]));
}

/** 同じ段の中の既定の並べ方：領域の番号の小さい順（24問） */
const byNumber = (x, y) => x - y;

/** 候補の領域を、1／3 → 2／4 → 1w／3w → 同じ段の中は order（既定は領域の番号の順）に */
function ranked(states, allowed, order = byNumber) {
  return DOMAIN_IDS4.filter((d) => allowed.includes(states[d]))
    .sort((x, y) => (TIER[states[x]] - TIER[states[y]]) || order(x, y) || (x - y));
}

/** 主軸 { domain, state, side }（候補が無ければ null）。order は同じ段の中の並べ方（三択だけが渡す） */
export function primaryOf4(states, { order = byNumber } = {}) {
  const d = ranked(states || {}, PRIMARY_STATES4, order)[0];
  return d ? { domain: d, state: states[d], side: copySide4(states[d]) } : null;
}

const themeOf = (d, side) => SIDE_COPY4[`${d}${side}`]?.theme ?? null;

/** 主軸の印：1・1w → A のテーマ、3・3w → B のテーマ、2・4・5 → A と B の両方のテーマ（6・7・incomplete は補足に使わない → []） */
export function claimTagsOf4(d, state) {
  const s = String(state);
  if (s === "1" || s === "1w") return [themeOf(d, "A")].filter(Boolean);
  if (s === "3" || s === "3w") return [themeOf(d, "B")].filter(Boolean);
  if (s === "2" || s === "4" || s === "5") return [themeOf(d, "A"), themeOf(d, "B")].filter(Boolean);
  return [];
}

const groupOf = (t) => THEME_GROUPS4.findIndex((g) => g.includes(t));

/** テーマ t が tags のどれかと同じか、同じ組（THEME_GROUPS4）か */
export function sameTheme4(t, tags) {
  if (!t) return false;
  const g = groupOf(t);
  return (tags || []).some((x) => x === t || (g >= 0 && groupOf(x) === g));
}

/** 領域ごとの文 { id, title, body }。7dd は専用の文（B{d}-7dd）、incomplete は未回答の文（B{d}-incomplete）。知らない領域・状態は null */
export function domainCopy4(d, state) {
  const D = DOMAIN_COPY4[Number(d)];
  if (!D) return null;
  if (state === "7dd") return { id: `B${Number(d)}-7dd`, ...DIFFERENT_DIRECTIONS_COPY4 };
  if (state === "incomplete") return { id: `B${Number(d)}-incomplete`, ...UNANSWERED_COPY4 };
  const c = D[state];
  return c ? { id: c.id, title: c.title, body: c.body } : null;
}

const len = (s) => (typeof s === "string" ? [...s].length : 0);

/** 本文＋補足＋一言の字数（題は数えない。一言の「」は数えない） */
export function copyChars4(copy) {
  if (!copy) return 0;
  return (copy.paragraphs || []).reduce((n, p) => n + len(p), 0) + len(copy.bridge) + len(copy.action);
}

/** 最初の1文（。？！ で切る。「」の中では切らない）。文の終わりが無ければ全部 */
export function firstSentence4(text) {
  const s = typeof text === "string" ? text : "";
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "「" || c === "『") depth++;
    else if ((c === "」" || c === "』") && depth > 0) depth--;
    else if (depth === 0 && (c === "。" || c === "？" || c === "！")) return s.slice(0, i + 1);
  }
  return s;
}

const out = (o, copyVersion = RESULT_COPY_VERSION4) => Object.freeze({
  copyVersion,
  copyId: o.copyId,
  kind: o.kind,
  primaryDomain: o.primaryDomain ?? null,
  side: o.side ?? null,
  title: o.title,
  paragraphs: Object.freeze([...(o.paragraphs || [])]),
  bridge: o.bridge ?? null,
  bridgeDomain: o.bridgeDomain ?? null,
  action: o.action ?? null,
  claimTags: Object.freeze([...(o.claimTags || [])]),
});

/** 補足の1文 { domain, text } か null（主軸 p、状態 states。order・bridgeOk は resultCopyFromStates の opts） */
function bridgeOf(p, states, { order = byNumber, bridgeOk = null } = {}) {
  const tags = claimTagsOf4(p.domain, p.state);
  for (const d of ranked(states, BRIDGE_STATES4, order)) {
    if (d === p.domain) continue;
    if (bridgeOk && !bridgeOk(d, states[d])) continue;
    const side = copySide4(states[d]);
    const t = themeOf(d, side);
    if (!t || sameTheme4(t, tags)) continue;
    const text = SIDE_COPY4[`${d}${side}`]?.bridge;
    if (text) return { domain: d, text };
  }
  return null;
}

/**
 * 24問の結果（js/engine4.js の computeResult4）から、結果の文を1セット
 *   主軸あり：{ kind: "primary", copyId: "B1-1", primaryDomain: 1, side: "A", title, paragraphs: [本文], bridge, bridgeDomain, action, claimTags }
 *   特別の組：{ kind: "pair", copyId: "PAIR-7B-8B", … bridge: null }
 *   主軸なし：kind "mixed"（状態5がある）・"hold"（答えがそろった領域はある）・"none"（無い。action も null）
 */
export function resultCopy4(r, { maxChars = COPY_MAX_CHARS4 } = {}) {
  return resultCopyFromStates(copyStatesOf4(r), { maxChars });
}

/**
 * 状態の表（{ 1: "1", 2: "7", … }。値は原稿の状態・"7dd"・"incomplete"）から、結果の文を1セット。24問と三択（決定 U49）で共有する
 *   opts（上の「三択（80問）とも共有する組み立て」）を渡さなければ、24問の決まりのまま
 */
export function resultCopyFromStates(states, {
  maxChars = COPY_MAX_CHARS4, copyVersion = RESULT_COPY_VERSION4, order = byNumber, bridgeOk = null, pairOk = null,
} = {}) {
  const st = states && typeof states === "object" ? states : {};
  const done = (o) => out(o, copyVersion);
  const p = primaryOf4(st, { order });
  if (!p) {
    const five = DOMAIN_IDS4.find((d) => st[d] === "5");
    if (five) {
      const c = DOMAIN_COPY4[five][5];
      return done({ kind: "mixed", copyId: OVERALL_COPY4.mixed.id, title: OVERALL_COPY4.mixed.title, paragraphs: [c.body], action: OVERALL_COPY4.mixed.action });
    }
    if (DOMAIN_IDS4.some((d) => st[d] && st[d] !== "incomplete")) {
      const o = OVERALL_COPY4.hold;
      return done({ kind: "hold", copyId: o.id, title: o.title, paragraphs: [o.body], action: o.action });
    }
    const o = OVERALL_COPY4.none;
    return done({ kind: "none", copyId: o.id, title: o.title, paragraphs: [o.body] });
  }
  if ((p.domain === 7 || p.domain === 8) && B_SIDE.has(st[7]) && B_SIDE.has(st[8]) && (!pairOk || pairOk(st))) {
    return done({
      kind: "pair", copyId: PAIR_7B_8B.id, primaryDomain: p.domain, side: "B",
      title: PAIR_7B_8B.title, paragraphs: PAIR_7B_8B.paragraphs, action: PAIR_7B_8B.action,
      claimTags: [themeOf(7, "B"), themeOf(8, "B")],
    });
  }
  const c = DOMAIN_COPY4[p.domain][p.state];
  const base = {
    kind: "primary", copyId: c.id, primaryDomain: p.domain, side: p.side,
    title: c.title, paragraphs: [c.body],
    action: SIDE_COPY4[`${p.domain}${p.side}`].action,
    claimTags: claimTagsOf4(p.domain, p.state),
  };
  const b = bridgeOf(p, st, { order, bridgeOk });
  if (b && copyChars4({ ...base, bridge: b.text }) <= maxChars) return done({ ...base, bridge: b.text, bridgeDomain: b.domain });
  return done(base);
}
